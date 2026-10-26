import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { registerEmployerComplianceRoutes } from "../../server/modules/employer-compliance";

const mocks = vi.hoisted(() => ({
  report: vi.fn(), validate: vi.fn(), contacts: vi.fn(), create: vi.fn(), participant: vi.fn(),
  get: vi.fn(), update: vi.fn(), started: vi.fn(), recipients: vi.fn(), template: vi.fn(),
  emailGet: vi.fn(), emailCreate: vi.fn(), emailUpdate: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  employerContacts: { getByEmployerIds: mocks.contacts },
  bulkMessages: { create: mocks.create, getByIdForUpdate: mocks.get, update: mocks.update },
  bulkParticipants: { hasNonPendingForMessage: mocks.started, getByMessageId: mocks.recipients },
  letterTemplates: { get: mocks.template },
  bulkMessagesEmail: { getByBulkId: mocks.emailGet, create: mocks.emailCreate, update: mocks.emailUpdate },
  ledger: { accounts: { get: async () => ({ name: "Legal trust" }) } },
} }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ requireAccess: () => () => {} }));
vi.mock("../../server/modules/components", () => ({ requireComponent: () => () => {} }));
vi.mock("../../server/storage/bulk/participants", () => ({
  createBulkParticipantStorage: () => ({ createIfMissing: mocks.participant }),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: async (fn: () => unknown) => fn(),
}));
vi.mock("../../server/plugins/wizards/registry", () => ({
  wizardPluginRegistry: { get: () => ({ name: "Monthly report" }) },
}));
vi.mock("../../server/services/employer-compliance", async () => ({
  ...await vi.importActual<typeof import("../../server/services/employer-compliance")>(
    "../../server/services/employer-compliance"),
  loadComplianceReport: mocks.report, validateComplianceReferences: mocks.validate,
}));

const employerId = "00000000-0000-0000-0000-000000000001";
const scope = { wizardType: "monthly", year: 2026, month: 10, monthsBack: 1,
  ledgerAccountIds: ["00000000-0000-0000-0000-000000000002"] };

async function queue(body: unknown) {
  let handler!: (req: Request, res: Response) => Promise<void>;
  registerEmployerComplianceRoutes({
    get: vi.fn(),
    post: (path: string, ...handlers: unknown[]) => {
      if (path.endsWith("/queue-bulk")) handler = handlers.at(-1) as typeof handler;
    },
  } as unknown as Express, () => {});
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await handler({ body } as Request, res as unknown as Response);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.report.mockResolvedValue({
    monthPeriods: [{ year: 2026, month: 10 }],
    rows: [{ employerId, employerName: "Example employer",
      months: [{ year: 2026, month: 10, status: null, balanceDelta: "25.00" }] }],
  });
  mocks.validate.mockResolvedValue(undefined);
  mocks.contacts.mockResolvedValue([{ employerId, contactId: "recipient" }]);
  mocks.create.mockImplementation(async input => ({ ...input, id: "message" }));
  mocks.participant.mockResolvedValue({});
  mocks.get.mockResolvedValue(undefined);
  mocks.started.mockResolvedValue(false);
  mocks.recipients.mockResolvedValue([]);
  mocks.update.mockImplementation(async (id, input) => ({ id, medium: ["email"], status: "draft", ...input }));
  mocks.emailGet.mockResolvedValue(undefined);
});

describe("queueing letters from compliance reports", () => {
  const body = { name: "Compliance letter", medium: ["email", "postal"],
    employerIds: [employerId], contactTypeIds: [], reportScope: scope };

  it("saves a server-generated report snapshot and run timestamp for every channel", async () => {
    const res = await queue(body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mocks.report.mock.calls[0][1]).toEqual(scope);
    const saved = mocks.create.mock.calls[0][0].data.complianceReport;
    expect(saved.scope).toEqual(scope);
    expect(Number.isNaN(Date.parse(saved.runAt))).toBe(false);
    expect(saved.employerByContact).toEqual({ recipient: employerId });
    expect(saved.valuesByEmployer[employerId]).toEqual({
      employer_name: "Example employer", missing_periods: "Oct 2026",
      delinquent_periods: "Oct 2026: 25.00", delinquent_total: "25.00",
      period_window: "Oct 2026 – Oct 2026",
    });
    expect(mocks.participant.mock.calls.map(([entry]) => entry.medium)).toEqual(["email", "postal"]);
  });

  it("rejects missing or invalid report settings before writing", async () => {
    for (const reportScope of [undefined, { ...scope, ledgerAccountIds: ["bad"] }]) {
      expect((await queue({ ...body, reportScope })).status).toHaveBeenCalledWith(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses employers no longer present in the report", async () => {
    expect((await queue({ ...body, employerIds: ["missing"] })).status).toHaveBeenCalledWith(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a shared contact rather than sending an arbitrary employer's figures", async () => {
    mocks.contacts.mockResolvedValue([
      { employerId, contactId: "recipient" }, { employerId: "other", contactId: "recipient" },
    ]);
    expect((await queue(body)).status).toHaveBeenCalledWith(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("adds to an existing draft using its channels, preserving offline/tag settings", async () => {
    mocks.get.mockResolvedValue({ id: "existing", medium: ["email"], status: "draft", data: { offline: true, tagIds: ["tag"] } });
    const res = await queue({ ...body, bulkMessageId: "existing", name: undefined, medium: undefined });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][1].data).toMatchObject({ offline: true, tagIds: ["tag"], complianceReport: { scope } });
    expect(mocks.participant).toHaveBeenCalledExactlyOnceWith({ messageId: "existing", contactId: "recipient", medium: "email" });
  });

  it("rejects missing, sent or delivery-started target messages", async () => {
    expect((await queue({ ...body, bulkMessageId: "missing" })).status).toHaveBeenCalledWith(404);
    mocks.get.mockResolvedValue({ id: "existing", medium: ["email"], status: "sent" });
    expect((await queue({ ...body, bulkMessageId: "existing" })).status).toHaveBeenCalledWith(409);
    mocks.get.mockResolvedValue({ id: "existing", medium: ["email"], status: "draft" });
    mocks.started.mockResolvedValue(true);
    expect((await queue({ ...body, bulkMessageId: "existing" })).status).toHaveBeenCalledWith(409);
    expect(mocks.participant).not.toHaveBeenCalled();
  });

  it("applies a compatible template when adding to an existing message", async () => {
    mocks.get.mockResolvedValue({ id: "existing", medium: ["email"], status: "draft" });
    mocks.template.mockResolvedValue({ id: "template", medium: "email", contextIds: ["bulk-message"], content: { subject: "Notice", bodyHtml: "<p>Notice</p>" } });
    const res = await queue({ ...body, bulkMessageId: "existing", templateIds: { email: "template" } });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mocks.emailCreate).toHaveBeenCalledWith({ bulkId: "existing", subject: "Notice", bodyHtml: "<p>Notice</p>", data: { letterTemplateId: "template" } });
  });

  it("counts duplicate participants as skipped without resetting their delivery state", async () => {
    mocks.participant.mockResolvedValue(undefined);
    const res = await queue(body);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ participantsCreated: 0, participantsSkipped: 2, participantFailures: 0 }));
  });
});
