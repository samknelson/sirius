import { describe, expect, it, vi } from "vitest";
import { EventType, type BaoCaseStatusSavedPayload } from "../../server/services/event-bus";
import type {
  EventNotifierEventContext,
  NotifierRecipient,
} from "../../server/plugins/event-notifier/types";

/**
 * The member-facing case notifier (`bao_case_member_notice`): the letter a
 * member is mailed when their appeal case enters a configured status.
 *
 * What is protected here would break silently: a letter that fires on the
 * wrong transition (or twice), that goes to nobody, or — the failure this
 * suite exists for — a default letter whose tokens advertise values that
 * never resolve, so the fund's member receives a letter with the benefit,
 * denial reason and SPD citation blank. The default templates are rendered
 * through the real token engine against the notifier's own roots.
 *
 * Storage is stubbed at the boundary the notifier reads through; no live
 * rows, no server.
 */

const AUTO_DENIED = "status-auto-denied";
const SUBMITTED = "status-submitted";
const APPROVED = "status-approved";

const CASE_ID = "case-1";
const WORKER_ID = "worker-1";
const CONTACT_ID = "contact-1";

const appealRow = {
  id: "appeal-1",
  caseId: CASE_ID,
  denialReasonId: "reason-1",
  data: null,
  benefitName: "Medical Plan A",
  denialReasonName: "Insufficient hours in the eligibility period",
  spdCitation: "SPD Article IV, Section 2",
};

const linkedComms: Array<Record<string, unknown>> = [];
const appealLookups: unknown[] = [];

vi.mock("../../server/storage", () => ({
  storage: {
    workers: {
      async getWorker(id: string) {
        if (id === WORKER_ID) return { id, contactId: CONTACT_ID };
        if (id === "worker-no-contact") return { id, contactId: null };
        return undefined;
      },
    },
    contacts: {
      async getContact(id: string) {
        return id === CONTACT_ID ? { id, displayName: "Pat Member" } : undefined;
      },
    },
    baoCases: {
      async getAppeal(ref: unknown) {
        appealLookups.push(ref);
        const byCase = ref as { caseId?: string };
        return byCase.caseId === CASE_ID ? appealRow : undefined;
      },
      async linkComm(input: Record<string, unknown>) {
        linkedComms.push(input);
      },
    },
    bulkTokens: {
      // The recipient root: `{{contact}}` is the addressee's display name.
      async getContactRow(id: string) {
        return id === CONTACT_ID ? { id, displayName: "Pat Member" } : null;
      },
      async getNameByReference() {
        return null;
      },
    },
  },
}));

// The token registry filters segments by enabled component; everything is
// on here so a refused render is never mistaken for a component gate.
vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: () => true,
  isCacheInitialized: () => true,
  getComponentCacheRevision: () => 1,
  getComponentCache: () => ({}),
  getEnabledComponentIdsSync: () => [],
  loadComponentCache: async () => ({}),
  invalidateComponentCache: () => undefined,
  updateComponentCache: async () => undefined,
}));

const { baoCaseMemberNotice, memberNoticeSendKey } = await import(
  "../../server/plugins/event-notifier/plugins/bao-case-member-notice"
);
const { baoCaseStatusNotifier } = await import(
  "../../server/plugins/event-notifier/plugins/bao-case-status-notifier"
);
const { composeFromTemplates, resolveTemplates } = await import(
  "../../server/plugins/event-notifier/token-templates"
);
const { LETTER_PAGE_HTML } = await import("../../shared/utils/html/letter-page");

function payload(overrides: Partial<BaoCaseStatusSavedPayload> = {}): BaoCaseStatusSavedPayload {
  return {
    caseId: CASE_ID,
    entityType: "worker",
    entityId: WORKER_ID,
    row: {
      id: CASE_ID,
      entityType: "worker",
      entityId: WORKER_ID,
      statusId: AUTO_DENIED,
      deadlineYmd: "2026-12-03",
    } as unknown as BaoCaseStatusSavedPayload["row"],
    previousStatusId: SUBMITTED,
    statusId: AUTO_DENIED,
    statusName: "Auto-Denied",
    entityName: "Pat Member",
    operation: "updated",
    ...overrides,
  };
}

function ctx(p: BaoCaseStatusSavedPayload): EventNotifierEventContext {
  return { event: EventType.BAO_CASE_STATUS_SAVED, payload: p } as EventNotifierEventContext;
}

const config = { statusIds: [AUTO_DENIED] };
const recipient: NotifierRecipient = { contactId: CONTACT_ID };

describe("bao_case_member_notice — when a letter fires", () => {
  it("is BAO-gated, member-facing (not staff), postal-first with an email copy", () => {
    expect(baoCaseMemberNotice.requiredComponent).toBe("sitespecific.bao");
    expect(baoCaseMemberNotice.staffNotification).toBeUndefined();
    expect(baoCaseMemberNotice.subscribedEvents).toEqual([EventType.BAO_CASE_STATUS_SAVED]);
    expect(baoCaseMemberNotice.supportedMedia).toEqual(["postal", "email"]);
  });

  it("fires on entry into a configured status: a transition or creation into it", () => {
    expect(baoCaseMemberNotice.shouldDispatch!(ctx(payload()), config)).toBe(true);
    const created = payload({ operation: "created", previousStatusId: null });
    expect(baoCaseMemberNotice.shouldDispatch!(ctx(created), config)).toBe(true);
  });

  it("does not fire on a save that leaves the status unchanged, or on another status", () => {
    const unchanged = payload({ previousStatusId: AUTO_DENIED });
    expect(baoCaseMemberNotice.shouldDispatch!(ctx(unchanged), config)).toBe(false);
    const elsewhere = payload({ previousStatusId: AUTO_DENIED, statusId: APPROVED });
    expect(baoCaseMemberNotice.shouldDispatch!(ctx(elsewhere), config)).toBe(false);
  });

  it("refuses a configuration with no status, at save time and at dispatch", async () => {
    const verdict = await baoCaseMemberNotice.validateConfigData!({ statusIds: [] });
    expect(verdict.valid).toBe(false);
    expect(baoCaseMemberNotice.shouldDispatch!(ctx(payload()), {})).toBe(false);
    expect((await baoCaseMemberNotice.validateConfigData!(config)).valid).toBe(true);
  });

  it("uses the same entry rule as the staff status notifier", () => {
    const staffConfig = { ...config, staffRecipientUserIds: ["staff-1"] };
    for (const p of [
      payload(),
      payload({ operation: "created", previousStatusId: null }),
      payload({ previousStatusId: AUTO_DENIED }),
      payload({ row: undefined as unknown as BaoCaseStatusSavedPayload["row"] }),
    ]) {
      expect(baoCaseMemberNotice.shouldDispatch!(ctx(p), config)).toBe(
        baoCaseStatusNotifier.shouldDispatch!(ctx(p), staffConfig),
      );
    }
  });
});

describe("bao_case_member_notice — who receives it", () => {
  it("writes to the case's worker through their contact", async () => {
    await expect(baoCaseMemberNotice.getRecipients!(ctx(payload()), config)).resolves.toEqual([
      { contactId: CONTACT_ID },
    ]);
  });

  it("writes to nobody for a case about an employer or a provider, or a worker with no contact", async () => {
    const employer = payload({ entityType: "employer", entityId: "employer-1" });
    await expect(baoCaseMemberNotice.getRecipients!(ctx(employer), config)).resolves.toEqual([]);
    const noContact = payload({ entityId: "worker-no-contact" });
    await expect(baoCaseMemberNotice.getRecipients!(ctx(noContact), config)).resolves.toEqual([]);
  });
});

describe("bao_case_member_notice — at most one letter per status entry", () => {
  it("keys the send on the case and the status entered, so a repeated emit is the same send", () => {
    const first = baoCaseMemberNotice.tokenTemplates!.sendKey!(ctx(payload()), "postal", recipient, config);
    const replay = baoCaseMemberNotice.tokenTemplates!.sendKey!(ctx(payload()), "postal", recipient, config);
    expect(first).toBe(replay);
    expect(first).toBe(memberNoticeSendKey({ caseId: CASE_ID, statusId: AUTO_DENIED }));
  });

  it("gives a later status entry — and another case — a key of its own", () => {
    const denied = memberNoticeSendKey({ caseId: CASE_ID, statusId: AUTO_DENIED });
    expect(memberNoticeSendKey({ caseId: CASE_ID, statusId: APPROVED })).not.toBe(denied);
    expect(memberNoticeSendKey({ caseId: "case-2", statusId: AUTO_DENIED })).not.toBe(denied);
  });

  it("records every comm the send layer hands back against the case and the status it was for", async () => {
    linkedComms.length = 0;
    await baoCaseMemberNotice.onCommCreated!(
      "postal",
      recipient,
      { id: "comm-1", status: "failed" } as never,
      ctx(payload()),
      config,
    );
    expect(linkedComms).toEqual([
      { caseId: CASE_ID, commId: "comm-1", statusId: AUTO_DENIED, statusName: "Auto-Denied" },
    ]);
  });
});

describe("bao_case_member_notice — the default letter says what it advertises", () => {
  async function seedsFor(p: BaoCaseStatusSavedPayload) {
    const seeds = [];
    for (const root of baoCaseMemberNotice.tokenTemplates!.roots) {
      const entity = await root.build(ctx(p));
      if (entity) seeds.push({ name: root.name, entity });
      else expect(root.optional).toBe(true);
    }
    return seeds;
  }

  it("seeds the case from the event and the appeal from storage, by the case id", async () => {
    appealLookups.length = 0;
    const seeds = await seedsFor(payload());
    expect(seeds.map((s) => s.name)).toEqual(["sitespecific_bao_case", "sitespecific_bao_appeal"]);
    expect(appealLookups).toEqual([{ caseId: CASE_ID }]);
    expect(seeds[1].entity.row).toMatchObject({ benefitName: "Medical Plan A" });
  });

  it("renders the default letter with the benefit, denial reason, SPD citation, status and deadline — no token left unresolved", async () => {
    const templates = resolveTemplates(baoCaseMemberNotice, config);
    const seeds = await seedsFor(payload());
    const letter = await composeFromTemplates(
      baoCaseMemberNotice,
      "postal",
      recipient,
      seeds,
      templates,
      new Map(),
    );
    expect(letter).not.toBeNull();
    const file = letter!.file!;
    for (const expected of [
      "Dear Pat Member",
      "Medical Plan A",
      "Auto-Denied",
      "Insufficient hours in the eligibility period",
      "SPD Article IV, Section 2",
      // The `date` column is a calendar day, formatted as one (never the
      // day before, which a UTC-midnight parse gives in a western zone).
      "Dec 3, 2026",
    ]) {
      expect(file).toContain(expected);
    }
    expect(file).not.toMatch(/\{\{|unknown token|\[missing/);
    // The body is mailed inside the standard letter page, the same page a
    // hand-composed letter gets.
    const [pageHead] = LETTER_PAGE_HTML.split("{{BODY}}");
    expect(file.startsWith(pageHead.trimStart().slice(0, 40))).toBe(true);
    expect(letter!.description).toBe("Benefit appeal letter — Auto-Denied — Pat Member");
  });

  it("still mails a letter for a case with no appeal behind it, with the appeal tokens at their defaults", async () => {
    const other = payload({ caseId: "case-2", row: { ...(payload().row as object), id: "case-2" } as never });
    const seeds = await seedsFor(other);
    expect(seeds.map((s) => s.name)).toEqual(["sitespecific_bao_case"]);
    const letter = await composeFromTemplates(
      baoCaseMemberNotice,
      "postal",
      recipient,
      seeds,
      resolveTemplates(baoCaseMemberNotice, config),
      new Map(),
    );
    expect(letter?.file).toContain("Auto-Denied");
    expect(letter?.file).not.toContain("Medical Plan A");
    expect(letter?.file).not.toMatch(/\{\{|unknown token/);
  });

  it("mails nothing when the letter body is blank, and carries the email copy's subject", async () => {
    const seeds = await seedsFor(payload());
    const blank = await composeFromTemplates(
      baoCaseMemberNotice,
      "postal",
      recipient,
      seeds,
      { postal: { bodyHtml: "   ", description: "x" } },
      new Map(),
    );
    expect(blank).toBeNull();
    const email = await composeFromTemplates(
      baoCaseMemberNotice,
      "email",
      recipient,
      seeds,
      resolveTemplates(baoCaseMemberNotice, config),
      new Map(),
    );
    expect(email?.subject).toBe("Your benefit appeal — Auto-Denied");
    expect(email?.bodyHtml).toContain("Medical Plan A");
  });
});
