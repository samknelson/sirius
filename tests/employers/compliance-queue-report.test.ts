import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { registerEmployerComplianceRoutes } from "../../server/modules/employer-compliance";

const mocks = vi.hoisted(() => ({
  report: vi.fn(), validate: vi.fn(), contacts: vi.fn(), create: vi.fn(), participant: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  employerContacts: { getByEmployerIds: mocks.contacts },
  bulkMessages: { create: mocks.create },
  ledger: { accounts: { get: async () => ({ name: "Legal trust" }) } },
} }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ requireAccess: () => () => {} }));
vi.mock("../../server/modules/components", () => ({ requireComponent: () => () => {} }));
vi.mock("../../server/storage/bulk/participants", () => ({
  createBulkParticipantStorage: () => ({ create: mocks.participant }),
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
  mocks.create.mockResolvedValue({ id: "message" });
  mocks.participant.mockResolvedValue({});
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
});
