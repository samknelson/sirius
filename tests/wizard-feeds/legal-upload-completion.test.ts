import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  contacts: vi.fn(), contact: vi.fn(), user: vi.fn(), entries: vi.fn(), invoice: vi.fn(), emit: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  contacts: { getContact: mocks.contact },
  employerContacts: { listByEmployer: mocks.contacts },
  users: { getUserByEmail: mocks.user },
  ledger: { ea: { getByEntity: async () => [{ id: "ea1" }, { id: "ea2" }] },
    entries: { getByReference: mocks.entries }, invoices: { getDetails: mocks.invoice } },
} }));
vi.mock("../../server/plugins/event-notifier/registry", () => ({ registerEventNotifier: vi.fn() }));
vi.mock("../../server/plugins/tokens/registry", () => ({ registerTokenPlugin: vi.fn() }));
vi.mock("../../server/config/env-registry", () => ({ getEnvironmentVariable: () => "https://example.com" }));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { GBHET_LEGAL_UPLOAD_COMPLETED_AFTER: "sitespecific.gbhet.legal.upload.complete.after" },
  eventBus: { emit: mocks.emit },
}));
import { gbhetLegalUploadCompletionNotifier as notifier } from "../../server/plugins/event-notifier/plugins/gbhet-legal-upload-completion";
import { legalUploadSummary, legalInvoiceLinks, legalCompletionSendKey } from "../../server/plugins/event-notifier/legal-upload-message";
import { resolveLegalActuals, publishLegalCompletion } from "../../server/plugins/wizards/gbhet-legal-completion";
import type { LegalUploadCompletedPayload } from "../../server/services/event-bus";
const payload = (): LegalUploadCompletedPayload => ({
  uploadId: "u", uploadType: "gbhet_legal_workers_monthly", employerId: "e",
  submitter: { userId: "uploader", contactId: "contact1" }, period: { month: 11, year: 2026 },
  outcome: "completed", resultsPath: "/wizards/u",
  invoices: [], totals: {
    newWorkers: 1, workersWithNewGrants: 2, newGrants: 3, processedRows: 4, failedRows: 0,
    postedCharges: 0, postedAmount: "0.00", chargeFailures: 0, chargeReadFailed: false, unpriceableGrants: 0,
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.contact.mockResolvedValue({ id: "contact1" });
  mocks.contacts.mockResolvedValue([
    { contactId: "contact1", contactTypeId: "selected", contact: { email: "a@example.com" } },
    { contactId: "contact2", contactTypeId: "selected", contact: { email: "b@example.com" } },
    { contactId: "contact2", contactTypeId: "selected", contact: { email: "b@example.com" } },
    { contactId: "excluded", contactTypeId: "other", contact: {} },
  ]);
  mocks.user.mockResolvedValue({ id: "other-user" });
  mocks.invoice.mockResolvedValue({ entries: [] });
  mocks.entries.mockResolvedValue([]);
});
it("includes the captured uploader, deduplicates selected employer contacts, and keeps self-notifications", async () => {
  const result = await notifier.getRecipients!({ event: "" as any, payload: payload() }, { contactTypeIds: ["selected"] });
  expect(result).toEqual([{ contactId: "contact1", userId: "uploader" }, { contactId: "contact2", userId: "other-user" }]);
  expect(mocks.contacts).toHaveBeenCalledWith("e");
  expect(notifier.notifySelf).toBe(true);
});
it("no selected types means uploader only; old drafts never invent an uploader", async () => {
  expect(await notifier.getRecipients!({ event: "" as any, payload: payload() }, {})).toHaveLength(1);
  const old = { ...payload(), submitter: null };
  expect(await notifier.getRecipients!({ event: "" as any, payload: old }, {})).toEqual([]);
  expect(mocks.contacts).not.toHaveBeenCalled();
});
it("uses the same completion key across repeats, configs and overlapping selectors", () => {
  const ctx = { event: "" as any, payload: payload() };
  expect(notifier.getSendKey!(ctx)).toBe(legalCompletionSendKey("u"));
  expect(notifier.getSendKey!({ ...ctx, configId: "other" })).toBe(notifier.getSendKey!(ctx));
});
it("resolves actual posted accounts and statement periods instead of guessing the upload month", async () => {
  mocks.entries.mockResolvedValue([
    { eaId: "ea1", amount: "20.00", statementYmd: "2026-11-30" },
    { eaId: "ea2", amount: "30.00", statementYmd: "2027-01-31" },
    { eaId: "not-owned", amount: "99.00", statementYmd: "2026-11-30" },
  ]);
  const { postedCharges, postedAmount, chargeReadFailed, ...base } = payload().totals;
  const actual = await resolveLegalActuals("e", ["wmb"], base);
  expect(actual.totals).toMatchObject({ postedCharges: 2, postedAmount: "50.00", chargeReadFailed: false });
  expect(actual.invoices.map(i => i.path)).toEqual(["/ea/ea1/invoices/11/2026", "/ea/ea2/invoices/1/2027"]);
  const links = legalInvoiceLinks({ ...payload(), ...actual }, true);
  expect(links).toContain('href="https://example.com/ea/ea1/invoices/11/2026"');
  expect(links).toContain('href="https://example.com/ea/ea2/invoices/1/2027"');
});
it("does not turn a charge read failure into a known zero or invoice-ready claim", async () => {
  mocks.entries.mockRejectedValue(new Error("cannot read"));
  const { postedCharges, postedAmount, chargeReadFailed, ...base } = payload().totals;
  const actual = await resolveLegalActuals("e", ["wmb"], base);
  expect(actual.totals.postedAmount).toBeNull();
  expect(actual.invoices).toEqual([]);
  expect(legalUploadSummary({ ...payload(), ...actual })).toContain("could not be confirmed");
  expect(legalUploadSummary(payload())).toContain("No invoice is available");
  expect(legalUploadSummary({ ...payload(), outcome: "completed_with_errors" })).toContain("completed with errors");
  expect(legalUploadSummary({ ...payload(), outcome: "failed" })).toContain("Processing failed");
});
it("emits a terminal snapshot without raw rows and never emits for historical results alone", async () => {
  const data = { launchArguments: payload().period, legalSubmitter: payload().submitter,
    legalCompletion: { totals: payload().totals, invoices: [] }, uploadedRows: [{ ssn: "sensitive" }] };
  await publishLegalCompletion({ id: "u", entityId: "e", type: payload().uploadType, status: "completed", data } as any, "completed");
  expect(mocks.emit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain("sensitive");
  await publishLegalCompletion({ id: "old", entityId: "e", data: { processResults: {} } } as any, "completed");
  expect(mocks.emit).toHaveBeenCalledTimes(1);
});
