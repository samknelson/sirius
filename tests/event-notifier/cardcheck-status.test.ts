import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardcheckStatusChangePayload } from "@shared/cardcheck-notification";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";

const fakes = vi.hoisted(() => ({
  worker: vi.fn(), contact: vi.fn(), user: vi.fn(), latest: vi.fn(), cardcheck: vi.fn(), definition: vi.fn(),
}));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: () => true }));
vi.mock("../../server/storage", () => ({
  storage: {
    workers: { getWorker: fakes.worker },
    contacts: { getContact: fakes.contact },
    users: { getUserByEmail: fakes.user },
    cardchecks: { getCardcheckById: fakes.cardcheck },
    cardcheckDefinitions: { getCardcheckDefinitionById: fakes.definition },
    bulkTokens: { getLatestCardcheckForWorker: fakes.latest },
  },
}));
import { EventType } from "../../server/services/event-bus";
import { cardcheckStatusNotifier as plugin } from "../../server/plugins/event-notifier/plugins/cardcheck-status-notifier";
import { composeFromTemplates, resolveTemplates } from "../../server/plugins/event-notifier/token-templates";
import { buildNotifierStudioRecords } from "../../server/plugins/event-notifier/studio-records";
import { eventBus } from "../../server/services/event-bus";
import { tokenPluginRegistry } from "../../server/plugins/tokens/registry";
import { CARDCHECK_TOKEN_FIELDS } from "@shared/cardcheck-notification";
import { registerEntityPathTokens } from "../../server/plugins/tokens/plugins/entity-paths";

registerEntityPathTokens();

function context(previousStatus: CardcheckStatusChangePayload["previousStatus"] = "signed",
  newStatus: CardcheckStatusChangePayload["newStatus"] = "revoked"): EventNotifierEventContext {
  return {
    event: EventType.CARDCHECK_STATUS_CHANGE_AFTER,
    payload: {
      cardcheckId: "changed-card", workerId: "affected-worker", cardcheckDefinitionId: "definition",
      previousStatus, newStatus,
      cardcheck: { id: "changed-card", workerId: "affected-worker", type: "Original <Authorization>",
        status: newStatus, signedDate: "2026-10-01T12:00:00.000Z" },
    } satisfies CardcheckStatusChangePayload,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.worker.mockResolvedValue({ contactId: "contact" });
  fakes.contact.mockResolvedValue({ id: "contact", email: "worker@example.invalid" });
  fakes.user.mockResolvedValue({ id: "account" });
});

describe("cardcheck status notification boundaries", () => {
  it.each(["pending", "signed", "revoked"] as const)("filters each configuration independently for %s", async destinationStatus => {
    for (const previous of ["pending", "signed", "revoked"] as const) {
      for (const next of ["pending", "signed", "revoked"] as const) {
        expect(await plugin.shouldDispatch!(context(previous, next), { destinationStatus }))
          .toBe(previous !== next && next === destinationStatus);
      }
    }
  });

  it.each([null, {}, { destinationStatus: "" }, { destinationStatus: "other" }])("fails closed for malformed settings %j", async config => {
    expect(await plugin.shouldDispatch!(context(), config)).toBe(false);
  });

  it("does not treat creation, missing snapshots, or inconsistent snapshots as transitions", async () => {
    for (const patch of [{ previousStatus: null }, { cardcheck: undefined }, { cardcheckId: "wrong-card" }]) {
      const ctx = context();
      expect(await plugin.shouldDispatch!({ ...ctx, payload: { ...ctx.payload as object, ...patch } },
        { destinationStatus: "revoked" })).toBe(false);
    }
  });

  it("resolves the affected worker's account and preserves self-notification", async () => {
    expect(plugin.notifySelf).toBe(true);
    expect(plugin.requiredComponent).toBe("cardcheck");
    expect(plugin.supportedMedia).toEqual(["email", "inapp"]);
    expect(await plugin.getRecipients!(context())).toEqual([{ contactId: "contact", userId: "account" }]);
    expect(fakes.worker).toHaveBeenCalledWith("affected-worker");
    expect(fakes.user).toHaveBeenCalledWith("worker@example.invalid");
    fakes.user.mockResolvedValue(undefined);
    expect(await plugin.getRecipients!(context())).toEqual([{ contactId: "contact", userId: undefined }]);
    fakes.worker.mockResolvedValue(undefined);
    expect(await plugin.getRecipients!(context())).toEqual([]);
    fakes.worker.mockResolvedValue({ contactId: "contact" });
    fakes.contact.mockResolvedValue(undefined);
    expect(await plugin.getRecipients!(context())).toEqual([]);
  });

  it.each(["email", "inapp"] as const)("renders the triggering snapshot through %s, not a later or different cardcheck", async medium => {
    fakes.latest.mockResolvedValue({ type: "Other card", status: "signed" });
    fakes.cardcheck.mockResolvedValue({ status: "pending" });
    const root = await plugin.tokenTemplates!.roots[0].build(context());
    const result = await composeFromTemplates(plugin, medium, { contactId: "contact", userId: "account" },
      [{ name: "cardcheck", entity: root! }], resolveTemplates(plugin, {}), new Map());
    expect(result.blankRequired).toEqual([]);
    expect(JSON.stringify(result.content)).toContain("Revoked");
    expect(JSON.stringify(result.content)).toContain(medium === "email" ? "Original &lt;Authorization&gt;" : "Original <Authorization>");
    expect(JSON.stringify(result.content)).not.toMatch(/unknown token|Other card|Pending|{{/);
    expect(fakes.latest).not.toHaveBeenCalled();
    expect(fakes.cardcheck).not.toHaveBeenCalled();
    if (medium === "inapp") expect(result.content?.linkUrl).toBe("/workers/affected-worker/union/cardchecks");
  });

  it("keeps templates independent and strips extension/signature data from event roots", async () => {
    const first = resolveTemplates(plugin, { templates: { email: { subject: "First {{cardcheck.field(name=\"status\")}}" } } });
    const second = resolveTemplates(plugin, { templates: { email: { subject: "Second" } } });
    expect(first.email?.subject).toContain("First");
    expect(second.email?.subject).toBe("Second");
    const ctx = context();
    const payload = ctx.payload as CardcheckStatusChangePayload;
    const root = await plugin.tokenTemplates!.roots[0].build({ ...ctx,
      payload: { ...payload, cardcheck: { ...payload.cardcheck, data: "private", esigId: "private", docRender: "private" } } });
    expect(root?.row).toEqual({ id: "changed-card", workerId: "affected-worker",
      type: "Original <Authorization>", status: "Revoked", signedDate: new Date("2026-10-01T12:00:00.000Z") });
    expect(tokenPluginRegistry.get("token.worker.cardcheck")?.metadata.entityFields).toEqual(CARDCHECK_TOKEN_FIELDS);
  });

  it("keeps exact-record preview and serialized-event date formatting consistent", async () => {
    fakes.cardcheck.mockResolvedValue({
      id: "changed-card", workerId: "affected-worker", cardcheckDefinitionId: "definition",
      status: "revoked", signedDate: new Date("2026-10-01T12:00:00.000Z"), data: { private: true }, esigId: "private",
    });
    fakes.definition.mockResolvedValue({ name: "Original <Authorization>" });
    const descriptor = tokenPluginRegistry.get("token.worker.cardcheck")!;
    expect(descriptor.metadata.previewEntity?.gate).toEqual({ scope: "record", policy: "cardcheck.view" });
    const { storage } = await import("../../server/storage");
    const preview = await descriptor.metadata.previewEntity!.load(storage, "changed-card");
    const event = await plugin.tokenTemplates!.roots[0].build(context());
    expect(preview?.entity).toEqual(event);
    expect(fakes.cardcheck).toHaveBeenCalledWith("changed-card");
    const templates = resolveTemplates(plugin, { templates: { email: {
      subject: '{{cardcheck.field(name="signed_date",format="Y-m-d")}}',
    } } });
    const result = await composeFromTemplates(plugin, "email", { contactId: "contact" },
      [{ name: "cardcheck", entity: event! }], templates, new Map());
    expect(result.content?.subject).toBe("2026-10-01");
    fakes.cardcheck.mockResolvedValue(undefined);
    expect(await descriptor.metadata.previewEntity!.load(storage, "deleted")).toBeNull();
  });

  it("offers Studio records only from matching events, with the exact cardcheck id", async () => {
    const ctx = context();
    const recent = vi.spyOn(eventBus, "getRecentEmits").mockReturnValue([{
      eventType: ctx.event, payload: ctx.payload, emittedAt: new Date(),
    } as ReturnType<typeof eventBus.getRecentEmits>[number]]);
    try {
      const matching = await buildNotifierStudioRecords(plugin, { destinationStatus: "revoked" });
      expect(matching.recordsByRoot.cardcheck.map(record => record.id)).toEqual(["changed-card"]);
      expect((await buildNotifierStudioRecords(plugin, { destinationStatus: "signed" })).recordsByRoot.cardcheck).toEqual([]);
    } finally { recent.mockRestore(); }
  });
});
