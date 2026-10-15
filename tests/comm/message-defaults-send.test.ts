import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({
  defaults: new Map<string, unknown>(),
  records: [] as Array<Record<string, any>>,
  details: [] as Array<Record<string, any>>,
  emailProvider: vi.fn(async (_params: unknown) => ({ success: true, messageId: "email-fixture" })),
  postalProvider: vi.fn(async (_params: unknown) => ({ success: true, letterId: "letter-fixture" })),
  render: vi.fn(async (_input: string, _options: unknown) => Buffer.from("%PDF-fixture")),
  optin: true, allowlist: true, mode: "test",
  eventHandler: undefined as undefined | ((payload: unknown) => Promise<void>),
}));
vi.mock("../../server/storage", () => ({ storage: {
  variables: { getByName: async (name: string) => state.defaults.has(name) ? { value: structuredClone(state.defaults.get(name)) } : undefined },
  commTags: { setTags: vi.fn() },
  contacts: {
    getContact: async () => ({ email: "person@example.invalid", displayName: "Fixture Recipient" }),
    addresses: { getContactPostalByContact: async () => [{
      street: "1 Test St", city: "City", state: "OR", postalCode: "97201", country: "US", isPrimary: true, isActive: true,
    }] },
  },
  optionsCommTag: {
    getBySiriusId: async () => ({ id: "fixture-tag" }),
    getByName: async () => ({ id: "fixture-tag" }),
  },
} }));
vi.mock("../../server/plugins/tokens", () => ({
  createTokenEvalContext: () => ({}),
  renderTokens: async (source: string) => ({ output: source }),
  buildTokenPickerEntries: () => [],
}));
vi.mock("../../server/modules/bulk/token-roots", () => ({ BULK_POSTAL_MERGE_ROOT_NAMES: [] }));
vi.mock("../../server/plugins/_core", () => ({ isPluginComponentEnabledSync: () => true }));
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { on: (options: { handler: typeof state.eventHandler }) => { state.eventHandler = options.handler; } },
}));
vi.mock("../../server/plugins/_core/plugin-config-cache", () => ({
  getEnabledConfigsForKind: async () => [{
    config: { id: "fixture", pluginId: "fixture", name: "Fixture", data: {} }, subsidiary: { media: "email,postal" },
  }],
}));
vi.mock("../../server/plugins/event-notifier/registry", () => ({
  eventNotifierRegistry: {
    listIds: () => ["fixture"],
    get: () => ({
      id: "fixture", name: "Fixture", subscribedEvents: ["fixture.event"], supportedMedia: ["email", "postal"],
      getRecipients: async () => [{ contactId: "contact" }],
      getMessage: async (medium: string) => medium === "email"
        ? { subject: "System subject", bodyText: "AUTOMATED TEXT" }
        : { file: '<p>AUTOMATED LETTER</p>' },
    }),
  },
}));
vi.mock("../../server/flood/service", () => ({
  checkFlood: async () => ({ allowed: true }), recordFloodEvent: async () => {},
}));
vi.mock("../../server/middleware/request-context", () => ({
  areNotificationsSuppressed: () => false, getRequestContext: () => undefined,
}));
vi.mock("../../server/plugins/event-notifier/flash-summary", () => ({ recordSentNotification: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({ runInTransaction: (fn: () => unknown) => fn() }));
vi.mock("../../server/storage/comm", () => ({
  createCommStorage: () => ({
    createComm: async (data: Record<string, any>) => {
      if (data.sendKey && state.records.some((row) => row.sendKey === data.sendKey)) return null;
      const record = { ...data, id: `comm-${state.records.length}` };
      state.records.push(record); return record;
    },
    updateComm: async (id: string, patch: Record<string, any>) => {
      const record = state.records.find((row) => row.id === id)!;
      Object.assign(record, patch); return record;
    },
    lockComm: vi.fn(),
    getCommWithDetails: async (id: string) => ({
      ...state.records.find((row) => row.id === id), postalDetails: state.details.find((row) => row.commId === id),
    }),
  }),
  createCommEmailStorage: () => ({
    createCommEmail: async (data: Record<string, any>) => {
      const row = { ...data, id: `detail-${state.details.length}` }; state.details.push(row); return row;
    },
    updateCommEmail: async (id: string, patch: Record<string, any>) => Object.assign(state.details.find((row) => row.id === id)!, patch),
  }),
  createCommPostalStorage: () => ({
    createCommPostal: async (data: Record<string, any>) => {
      const row = { ...data, id: `detail-${state.details.length}` }; state.details.push(row); return row;
    },
    updateCommPostal: async (id: string, patch: Record<string, any>) => Object.assign(state.details.find((row) => row.id === id)!, patch),
  }),
  createCommEmailOptinStorage: () => ({ getEmailOptinByEmail: async () => ({ optin: state.optin, allowlist: state.allowlist }) }),
  createCommPostalOptinStorage: () => ({ getPostalOptinByCanonicalAddress: async () => ({ optin: state.optin, allowlist: state.allowlist }) }),
}));
vi.mock("../../server/services/comm/send-key", () => ({
  ALREADY_SENT: "ALREADY_SENT", findSentWithKey: async () => state.records[0],
}));
vi.mock("../../server/services/comm/callback-handlers/url-builder", () => ({ buildStatusCallbackUrl: () => "https://example.invalid/callback" }));
vi.mock("../../server/services/system-mode", () => ({ getSystemMode: async () => state.mode }));
vi.mock("../../server/services/service-registry", () => ({
  serviceRegistry: { resolve: async (medium: string) => medium === "email" ? {
    supportsEmail: () => true, validateEmail: async (email: string) => ({ valid: true, formatted: email }),
    getDefaultFromAddress: async () => ({ email: "sender@example.invalid" }), sendEmail: state.emailProvider,
  } : {
    id: "local", supportsPostal: () => true, getDefaultReturnAddress: async () => ({ addressLine1: "1 Return St", city: "City", state: "OR", zip: "97201", country: "US" }),
    sendLetter: state.postalProvider,
  } },
}));
vi.mock("../../server/services/comm/validators/address-verification", () => ({
  verifyPostalAddress: async (_transport: unknown, address: unknown) => ({ valid: true, normalizedAddress: address, canonicalAddress: "fixture" }),
}));
vi.mock("../../server/services/comm/letter-pdf", async (original) => ({
  ...await original<typeof import("../../server/services/comm/letter-pdf")>(), renderLetterPdf: state.render,
}));
vi.mock("../../server/services/comm/remote-letter-pdf", () => ({ downloadRemoteLetterPdf: async () => Buffer.from("%PDF-remote-unchanged") }));
vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, storageLogger: { error: vi.fn() } }));

import { sendEmail } from "../../server/services/comm/senders/email";
import { sendPostal } from "../../server/services/comm/senders/postal";
import { wrapLetterPage } from "@shared/utils/html/letter-page";
import { htmlToPlainText } from "@shared/utils/html";
import { renderRecordedLetter } from "../../server/services/comm/recorded-letter";
import { deliverEmail } from "../../server/modules/bulk/deliver-email";
import { deliverPostal } from "../../server/modules/bulk/deliver-postal";
import { storage, type IStorage } from "../../server/storage";
import { initializeEventNotifierDispatcher } from "../../server/plugins/event-notifier/dispatcher";

describe("shared delivery boundaries and effective history snapshots", () => {
  const email = { contactId: "contact", toEmail: "person@example.invalid", subject: "Subject", bodyHtml: "<p>BODY</p>" };
  const postal = { contactId: "contact", toAddress: { name: "Fictional Recipient", addressLine1: "1 Test St", city: "City", state: "OR", zip: "97201", country: "US" }, file: "<p>BODY</p>" };
  beforeEach(() => {
    state.records.length = state.details.length = 0;
    state.defaults.clear();
    state.defaults.set("message_defaults:email", { letterheadHtml: "<p>EMAILBRAND</p>" });
    state.defaults.set("message_defaults:postal", { letterheadHtml: "<p>POSTALBRAND</p>", footerHtml: "<p>FOOTER</p>", showPageCount: true });
    state.optin = state.allowlist = true; state.mode = "test";
    vi.clearAllMocks();
    state.render.mockResolvedValue(Buffer.from("%PDF-fixture"));
  });

  it.each([false, true])("stores exactly the email alternatives used for online/offline delivery (offline=%s)", async (offline) => {
    expect((await sendEmail({ ...email, sendOffline: offline })).success).toBe(true);
    const detail = state.details[0];
    expect(detail.bodyHtml.match(/EMAILBRAND/g)).toHaveLength(1);
    expect(detail.bodyText).toBe(htmlToPlainText(detail.bodyHtml));
    expect(detail.data.messageDefaults).toEqual({ letterheadHtml: "<p>EMAILBRAND</p>" });
    if (offline) expect(state.emailProvider).not.toHaveBeenCalled();
    else expect(state.emailProvider).toHaveBeenCalledWith(expect.objectContaining({ html: detail.bodyHtml, text: detail.bodyText }));
    state.defaults.set("message_defaults:email", { letterheadHtml: "<p>LATERBRAND</p>" });
    expect((await sendEmail({ ...email, sendOffline: offline })).success).toBe(true);
    expect(state.details[1].bodyHtml).toContain("LATERBRAND");
    expect(detail.bodyHtml).not.toContain("LATERBRAND");
    expect(detail.data.messageDefaults.letterheadHtml).toBe("<p>EMAILBRAND</p>");
    expect(email.bodyHtml).toBe("<p>BODY</p>");
  });

  it("covers plain-text-only system messages and rejects blank subject/body before decoration", async () => {
    expect((await sendEmail({ ...email, bodyHtml: undefined, bodyText: "SYSTEM <notice>\nNext" })).success).toBe(true);
    expect(state.details[0].bodyHtml).toContain("SYSTEM &lt;notice&gt;<br>Next");
    expect(state.details[0].bodyText).toContain("EMAILBRAND");
    for (const request of [{ ...email, subject: "" }, { ...email, bodyHtml: "" }]) {
      expect(await sendEmail(request)).toMatchObject({ success: false, errorCode: "VALIDATION_ERROR" });
    }
    expect(state.records).toHaveLength(1);
  });

  it.each([false, true])("prepares notifier-wrapped postal once, stores layout snapshots, and validates online/offline (offline=%s)", async (offline) => {
    expect((await sendPostal({ ...postal, file: wrapLetterPage(postal.file), sendOffline: offline })).success).toBe(true);
    const detail = state.details[0];
    expect(detail.body.match(/POSTALBRAND/g)).toHaveLength(1);
    expect(detail.data.messageDefaults).toEqual({ letterheadHtml: "<p>POSTALBRAND</p>", footerHtml: "<p>FOOTER</p>", showPageCount: true });
    expect(state.render).toHaveBeenCalledWith(detail.body, { defaults: { letterheadHtml: "", footerHtml: "<p>FOOTER</p>", showPageCount: true } });
    if (offline) expect(state.postalProvider).not.toHaveBeenCalled();
    else expect(state.postalProvider).toHaveBeenCalledWith(expect.objectContaining({ pdfFile: Buffer.from("%PDF-fixture") }));
    state.defaults.set("message_defaults:postal", { letterheadHtml: "NEW", footerHtml: "CHANGED", showPageCount: false });
    expect(detail.data.messageDefaults.footerHtml).toBe("<p>FOOTER</p>");
    expect(detail.data.messageDefaults.showPageCount).toBe(true);
    await renderRecordedLetter({ body: detail.body, data: detail.data });
    expect(state.render).toHaveBeenLastCalledWith(detail.body, {
      previewGuides: true, defaults: { letterheadHtml: "", footerHtml: "<p>FOOTER</p>", showPageCount: true },
    });
    expect(postal.file).toBe("<p>BODY</p>");
  });

  it("leaves Lob templates and remote rendered documents untouched", async () => {
    expect((await sendPostal({ ...postal, file: undefined, templateId: "tmpl_fixture" })).success).toBe(true);
    expect(state.postalProvider).toHaveBeenLastCalledWith(expect.objectContaining({ templateId: "tmpl_fixture", pdfFile: undefined }));
    expect(state.details[0].data.messageDefaults).toBeUndefined();
    expect((await sendPostal({ ...postal, file: "https://example.invalid/ready.pdf" })).success).toBe(true);
    expect(state.postalProvider).toHaveBeenLastCalledWith(expect.objectContaining({ pdfFile: Buffer.from("%PDF-remote-unchanged") }));
    expect(state.details[1].body).toBe("https://example.invalid/ready.pdf");
    expect(state.render).not.toHaveBeenCalled();
  });

  it("retains opt-in, allowlist and send-once refusals", async () => {
    state.optin = false;
    expect(await sendEmail(email)).toMatchObject({ success: false, errorCode: "NOT_OPTED_IN" });
    expect(await sendPostal(postal)).toMatchObject({ success: false, errorCode: "NOT_OPTED_IN" });
    expect(state.emailProvider).not.toHaveBeenCalled(); expect(state.postalProvider).not.toHaveBeenCalled();
    state.optin = true; state.allowlist = false;
    expect(await sendEmail(email)).toMatchObject({ success: false, errorCode: "NOT_ALLOWLISTED" });
    expect(await sendPostal(postal)).toMatchObject({ success: false, errorCode: "NOT_ALLOWLISTED" });
    state.allowlist = true;
    expect((await sendEmail({ ...email, sendKey: "once-email" })).success).toBe(true);
    expect((await sendEmail({ ...email, sendKey: "once-email" })).alreadySent).toBe(true);
    expect((await sendPostal({ ...postal, sendKey: "once-postal" })).success).toBe(true);
    expect((await sendPostal({ ...postal, sendKey: "once-postal" })).alreadySent).toBe(true);
    expect(state.emailProvider).toHaveBeenCalledOnce(); expect(state.postalProvider).toHaveBeenCalledOnce();
  });

  it.each([false, true])("runs bulk delivery through the same effective defaults without changing saved content (offline=%s)", async (offline) => {
    const emailSource = { subject: "Bulk subject", bodyHtml: "<p>BULKBODY</p>" };
    const postalSource = { bodyHtml: "<p>BULKLETTER</p>" };
    const bulkStorage = {
      ...storage,
      bulkMessagesEmail: { getByBulkId: async () => emailSource },
      bulkMessagesPostal: { getByBulkId: async () => postalSource },
    } as unknown as IStorage;
    expect((await deliverEmail(bulkStorage, "bulk", "contact", [], undefined, [], offline)).success).toBe(true);
    expect((await deliverPostal(bulkStorage, "bulk", "contact", [], undefined, [], offline)).success).toBe(true);
    expect(state.details[0].bodyHtml.match(/EMAILBRAND/g)).toHaveLength(1);
    expect(state.details[1].body.match(/POSTALBRAND/g)).toHaveLength(1);
    expect(emailSource.bodyHtml).toBe("<p>BULKBODY</p>");
    expect(postalSource.bodyHtml).toBe("<p>BULKLETTER</p>");
  });

  it("runs automated email and postal notifications through real shared senders", async () => {
    initializeEventNotifierDispatcher();
    expect(state.eventHandler).toBeTypeOf("function");
    await state.eventHandler!({});
    expect(state.emailProvider).toHaveBeenCalledOnce();
    expect(state.postalProvider).toHaveBeenCalledOnce();
    expect(state.details[0].bodyText).toContain("EMAILBRAND");
    expect(state.details[0].bodyText).toContain("AUTOMATED TEXT");
    expect(state.details[1].body).toContain("POSTALBRAND");
    expect(state.details[1].body).toContain("AUTOMATED LETTER");
    expect(state.details[1].data.messageDefaults.showPageCount).toBe(true);
  });

  it.each([false, true])("refuses oversized and page-splitting letterheads in the real postal renderer (offline=%s)", async (sendOffline) => {
    const real = await vi.importActual<typeof import("../../server/services/comm/letter-pdf")>("../../server/services/comm/letter-pdf");
    state.render.mockImplementation((input, options) => real.renderLetterPdf(input, options as Parameters<typeof real.renderLetterPdf>[1]));
    for (const letterheadHtml of [
      '<p style="height:4in">OVERSIZED</p>',
      '<div style="height:8in">SPLITACROSSPAGES</div>',
      '<p style="break-before:page">FORCEDBREAK</p>',
    ]) {
      state.defaults.set("message_defaults:postal", { letterheadHtml, footerHtml: "", showPageCount: false });
      const result = await sendPostal({ ...postal, sendOffline });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Postal Letterhead/);
      expect(state.records).toHaveLength(0);
      expect(state.details).toHaveLength(0);
      expect(state.postalProvider).not.toHaveBeenCalled();
      const effectiveBody = await real.prepareLetterHtml(postal.file, letterheadHtml);
      await expect(renderRecordedLetter({
        body: effectiveBody, data: { messageDefaults: { letterheadHtml, footerHtml: "", showPageCount: false } },
      })).rejects.toThrow(/Postal Letterhead/);
    }
    state.defaults.set("message_defaults:postal", { letterheadHtml: "<p>VALIDLETTERHEAD</p>", footerHtml: "", showPageCount: false });
    expect((await sendPostal({ ...postal, sendOffline })).success).toBe(true);
    expect(state.details[0].body.match(/VALIDLETTERHEAD/g)).toHaveLength(1);
  }, 90_000);

  it("keeps individual, bulk and notifier delivery on these exact shared senders", () => {
    for (const [path, medium] of [
      ["server/modules/comm.ts", "email"], ["server/modules/bulk/deliver-email.ts", "email"],
      ["server/modules/comm.ts", "postal"], ["server/modules/bulk/deliver-postal.ts", "postal"],
    ]) {
      const source = readFileSync(path, "utf8");
      const functionName = medium === "email" ? "sendEmail" : "sendPostal";
      expect(source).toContain(`senders/${medium}`);
      expect(source).toContain(`${functionName}({`);
    }
    const notifier = readFileSync("server/plugins/event-notifier/dispatcher.ts", "utf8");
    expect(notifier).toContain("senders/email"); expect(notifier).toContain("senders/postal");
  });
});
