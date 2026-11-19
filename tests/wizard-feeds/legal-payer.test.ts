import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as any[], callbacks: [] as Array<() => void>, wizard: {} as any,
  optedIn: true, manage: true, view: true,
  create: vi.fn(), link: vi.fn(), send: vi.fn(), globalContact: undefined as any,
}));
vi.mock("../../server/storage", () => ({ storage: {
  employerContacts: {
    listByEmployer: async () => state.rows,
    create: async (input: any) => state.link(input),
  },
  contacts: {
    getContactByEmail: async () => state.globalContact,
    createContact: async (input: any) => { state.create(input); return { ...input, id: "new-contact" }; },
  },
  wizards: {
    withLocked: async (_id: string, callback: any) => callback(state.wizard),
    update: async (_id: string, update: any) => Object.assign(state.wizard, update),
  },
} }));
vi.mock("../../server/storage/comm", () => ({ createCommEmailOptinStorage: () => ({
  getEmailOptinByEmail: async () => ({ optin: state.optedIn }),
}) }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  checkAccessInline: async (_req: unknown, policy: string) => ({ granted: policy === "employer.manage" ? state.manage : state.view }),
}));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "actor" } }) }));
vi.mock("../../server/storage/transaction-context", () => ({
  onAfterCommit: (callback: () => void) => state.callbacks.push(callback),
  runOutsideTransaction: (callback: () => void) => callback(),
}));
vi.mock("../../server/services/comm/callback-handlers/url-builder", () => ({ getPublicBaseUrl: () => "https://example.org" }));
vi.mock("../../server/services/comm/senders/email", () => ({ sendEmail: (request: any) => state.send(request) }));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn() } }));
import { getLegalPayerOptions, queueLegalPayer } from "../../server/plugins/wizards/gbhet-legal-payer";
import { legalPayerSchema, type LegalPayer } from "@shared/legal-payment";

const group = { eaId: "ea", accountId: "account", accountName: "Legal", currency: "USD", amount: "120.00", entries: 12, invoicePaths: [] };
let ctx: any;
beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [{ contactId: "contact", contact: { id: "contact", displayName: "Employer Payer", email: "payer@example.org" } }];
  state.callbacks = []; state.optedIn = true; state.manage = true; state.view = true; state.globalContact = undefined;
  state.wizard = { data: {}, entityId: "employer" };
  ctx = { wizard: state.wizard, wizardId: "upload", req: { session: {}, user: {} } };
  state.send.mockResolvedValue({ success: true, comm: { id: "comm", status: "sent" } });
});
async function request(payer: LegalPayer = { source: "contact", contactId: "contact" }) {
  const result = await queueLegalPayer(ctx, group, payer);
  Object.assign(state.wizard.data, result.data);
  return state.wizard.data.legalPayerHandoffs?.ea;
}
async function flush() {
  state.callbacks.splice(0).forEach(callback => callback());
  await vi.waitFor(() => expect(state.wizard.data.legalPayerHandoffs.ea.status).not.toBe("queued"));
}
describe("Legal payer handoff", () => {
  it("lists only this employer's contacts with opt-in and save permissions", async () => {
    state.manage = false; state.optedIn = false;
    expect(await getLegalPayerOptions(ctx)).toEqual({
      canSavePayerContact: false,
      payerContacts: [{ contactId: "contact", name: "Employer Payer", email: "payer@example.org", optedIn: false }],
    });
    state.view = false;
    expect((await getLegalPayerOptions(ctx)).payerContacts).toEqual([]);
  });
  it("rejects contacts outside this employer and missing emails", async () => {
    await expect(request({ source: "contact", contactId: "another-employer-contact" })).rejects.toThrow(/linked to this upload/);
    state.rows[0].contact.email = null;
    await expect(request()).rejects.toThrow(/no email address/);
    expect(state.callbacks).toHaveLength(0);
  });
  it("commits before sending, uses authorized invoice links, and suppresses duplicate requests", async () => {
    const queued = await request();
    expect(queued.status).toBe("queued"); expect(state.send).not.toHaveBeenCalled();
    await request(); expect(state.callbacks).toHaveLength(1);
    await flush();
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toMatchObject({ contactId: "contact", userId: "actor", toEmail: "payer@example.org" });
    expect(state.send.mock.calls[0][0].bodyHtml).toContain("https://example.org/ea/ea/invoices");
    expect(state.wizard.data.legalPayerHandoffs.ea).toMatchObject({ status: "sent", commId: "comm" });
    await request(); expect(state.callbacks).toHaveLength(0);
  });
  it("preserves opt-in for new payers while independently saving an employer contact", async () => {
    state.optedIn = false;
    const handoff = await request({ source: "new", name: "New Payer", email: "new@example.org", saveContact: true });
    expect(state.create).toHaveBeenCalledWith({ displayName: "New Payer", email: "new@example.org" });
    expect(state.link).toHaveBeenCalledWith({ employerId: "employer", contactId: "new-contact" });
    expect(handoff).toMatchObject({ status: "blocked", savedContact: true });
    expect(handoff.message).toContain("has not opted in");
    expect(state.callbacks).toHaveLength(0); expect(state.send).not.toHaveBeenCalled();
  });
  it("does not create or link an unconsented ad-hoc contact when save was declined", async () => {
    state.optedIn = false;
    const handoff = await request({ source: "new", name: "New Payer", email: "new@example.org", saveContact: false });
    expect(handoff).toMatchObject({ status: "blocked", contactId: null, savedContact: false });
    expect(state.create).not.toHaveBeenCalled(); expect(state.link).not.toHaveBeenCalled();
  });
  it("can notify an opted-in ad-hoc payer without adding them to employer contacts", async () => {
    const handoff = await request({ source: "new", name: "<Payer>", email: "new@example.org", saveContact: false });
    expect(handoff).toMatchObject({ contactId: "new-contact", savedContact: false });
    expect(state.link).not.toHaveBeenCalled();
    await flush();
    expect(state.send.mock.calls[0][0].bodyHtml).toContain("&lt;Payer&gt;");
  });
  it("enforces contact-save permissions and never links an unrelated existing person", async () => {
    state.manage = false;
    await expect(request({ source: "new", name: "New", email: "new@example.org", saveContact: true })).rejects.toThrow(/permission/);
    state.manage = true; state.globalContact = { id: "foreign-contact" };
    await expect(request({ source: "new", name: "New", email: "new@example.org", saveContact: true })).rejects.toThrow(/outside this employer/);
    expect(state.link).not.toHaveBeenCalled();
  });
  it("retains sender failures rather than claiming the recipient was notified", async () => {
    state.send.mockResolvedValue({ success: false, error: "Not allowlisted", comm: { id: "failed-comm", status: "failed" } });
    await request(); await flush();
    expect(state.wizard.data.legalPayerHandoffs.ea).toMatchObject({ status: "failed", message: "Email not sent: Not allowlisted", commId: "failed-comm" });
  });
  it("recovers an old queued handoff using the same send-once key", async () => {
    await request();
    const handoff = state.wizard.data.legalPayerHandoffs.ea;
    handoff.requestedAt = new Date(Date.now() - 180_000).toISOString();
    state.callbacks = [];
    await request(); await flush();
    expect(state.send.mock.calls[0][0].sendKey).toBe(`legal-payer:upload:ea:${handoff.attemptId}`);
  });
  it("validates new payers and rejects unrecognized payment/online fields", () => {
    expect(legalPayerSchema.safeParse({ source: "new", name: " ", email: "bad", saveContact: true }).success).toBe(false);
    expect(legalPayerSchema.safeParse({ source: "contact", contactId: "contact", method: "online" }).success).toBe(false);
  });
});
