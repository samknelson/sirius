import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getForUpdate: vi.fn(), update: vi.fn(), list: vi.fn(), search: vi.fn(),
  candidates: vi.fn(), siblings: vi.fn(), restored: vi.fn(),
  payment: vi.fn(), account: vi.fn(), handlers: new Map<string, (p: any) => Promise<void>>(),
}));
vi.mock("../../server/storage/database", () => ({
  storage: { baoCobraCases: {
    getForUpdate: mocks.getForUpdate, update: mocks.update,
    listLifecycleCandidates: mocks.candidates, search: mocks.search,
    listElectedActiveCasesForCoveredPerson: mocks.siblings,
    hasActiveMedicalOrDentalBenefits: mocks.restored,
  } },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<any>) => fn(),
  runOutsideTransaction: (fn: () => Promise<any>) => fn(),
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: mocks.list }),
}));
vi.mock("../../server/modules/sitespecific/bao/cobra-payment-state", () => ({
  evaluateCobraCasePayment: mocks.payment, resolveCobraAccountId: mocks.account,
  todayYmdLocal: () => "2026-03-01",
}));
vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true, isComponentEnabledSync: () => true,
}));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { LEDGER_ENTRY_SAVED: "ledger", BAO_COBRA_CASE_SAVED: "case" },
  eventBus: { on: ({ name, handler }: any) => mocks.handlers.set(name, handler) },
}));
const { reconcileCobraCaseStatus, scanCobraCaseStatuses, initBaoCobraLifecycle } =
  await import("../../server/services/bao-cobra-lifecycle");
const statuses = [
  { id: "new", name: "New", closed: false },
  { id: "pending", name: "Pending First Payment", closed: false },
  { id: "enrolled", name: "Enrolled", closed: false },
  { id: "delinquent", name: "Delinquent", closed: false },
  { id: "closed", name: "Closed", closed: true },
];
const theCase = {
  id: "case", statusId: "pending", paymentStatus: null, coveredPersonWorkerId: "w",
  electionMadeYmd: "2026-01-01", cobraEffectiveYmd: "2026-01-01",
  initialPaymentDeadlineYmd: "2026-02-15", maxPeriodYmd: "2027-07-01",
};

describe("COBRA reconciliation orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getForUpdate.mockResolvedValue({ ...theCase });
    mocks.list.mockResolvedValue(statuses);
    mocks.account.mockResolvedValue("cobra");
    mocks.siblings.mockResolvedValue([theCase]);
    mocks.restored.mockResolvedValue(false);
    mocks.payment.mockResolvedValue({ status: "Enrolled", paymentStatus: "paid", initialSatisfied: true, blockers: [] });
    mocks.search.mockResolvedValue([{ ...theCase, statusClosed: false }]);
  });
  it("defaults to dry run; live updates through normal auditable storage", async () => {
    expect(await reconcileCobraCaseStatus("case")).toMatchObject({
      applied: false, changes: { statusId: "enrolled", paymentStatus: "paid" },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    await reconcileCobraCaseStatus("case", { mode: "live" });
    expect(mocks.update).toHaveBeenCalledWith("case", { statusId: "enrolled", paymentStatus: "paid" });
  });
  it("does not write for duplicate events or reopen a closure read under lock", async () => {
    mocks.getForUpdate.mockResolvedValueOnce({ ...theCase, statusId: "enrolled", paymentStatus: "paid" });
    expect((await reconcileCobraCaseStatus("case", { mode: "live" })).changes).toEqual({});
    mocks.getForUpdate.mockResolvedValueOnce({ ...theCase, statusId: "closed" });
    expect((await reconcileCobraCaseStatus("case", { mode: "live" })).changes).toEqual({});
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("diagnoses absent, ambiguous, or wrong-closed-flag target configuration", async () => {
    for (const options of [
      statuses.filter((s) => s.id !== "enrolled"),
      [...statuses, { id: "duplicate", name: "enrolled", closed: false }],
      statuses.map((s) => s.id === "enrolled" ? { ...s, closed: true } : s),
    ]) {
      mocks.list.mockResolvedValueOnce(options);
      expect((await reconcileCobraCaseStatus("case", { mode: "live" })).blockers.join()).toMatch(/Missing or ambiguous/);
    }
    mocks.getForUpdate.mockResolvedValueOnce({ ...theCase, statusId: "missing" });
    expect((await reconcileCobraCaseStatus("case")).blockers).toContain("Current COBRA status is missing");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("diagnoses missing/ambiguous accounts and payment evidence", async () => {
    mocks.account.mockResolvedValueOnce(null);
    expect((await reconcileCobraCaseStatus("case")).blockers.join()).toMatch(/No COBRA billing account/);
    mocks.account.mockRejectedValueOnce(new Error("Ambiguous COBRA billing accounts"));
    expect((await reconcileCobraCaseStatus("case")).blockers.join()).toMatch(/Ambiguous/);
    mocks.payment.mockResolvedValueOnce({ blockers: ["No posted case premium for 2026-01"] });
    expect((await reconcileCobraCaseStatus("case", { mode: "live" })).blockers.join()).toMatch(/No posted/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuses overlapping cases sharing monthly allocations", async () => {
    mocks.siblings.mockResolvedValue([theCase, { ...theCase, id: "other" }]);
    expect((await reconcileCobraCaseStatus("case")).blockers.join()).toMatch(/Overlapping/);
  });
  it("closes expired and restored unelected cases without needing a billing account", async () => {
    mocks.getForUpdate.mockResolvedValueOnce({ ...theCase, maxPeriodYmd: "2026-02-28" });
    expect((await reconcileCobraCaseStatus("case", { mode: "live" })).changes.statusId).toBe("closed");
    mocks.getForUpdate.mockResolvedValueOnce({ ...theCase, electionMadeYmd: null });
    mocks.restored.mockResolvedValueOnce(true);
    expect((await reconcileCobraCaseStatus("case", { mode: "live" })).changes.statusId).toBe("closed");
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it("scan recovery isolates failures, includes broken statuses, and reports truncation", async () => {
    mocks.candidates.mockResolvedValueOnce([{ id: "bad" }, theCase]).mockResolvedValueOnce([]);
    mocks.getForUpdate.mockRejectedValueOnce(new Error("case failure"));
    const report = await scanCobraCaseStatuses("live");
    expect(report.results).toHaveLength(2);
    expect(report.results[0].blockers).toEqual(["case failure"]);
    expect(report.results[1].applied).toBe(true);
    mocks.candidates.mockResolvedValueOnce([theCase]).mockResolvedValueOnce([{ id: "remaining" }]);
    expect((await scanCobraCaseStatuses("test", 1)).truncated).toBe(true);
  });
  it("uses only affected worker/account events and ignores deletion feedback", async () => {
    initBaoCobraLifecycle();
    const ledger = mocks.handlers.get("bao-cobra-lifecycle-ledger")!;
    await ledger({ entityType: "worker", entityId: "w", accountId: "unrelated" });
    expect(mocks.update).not.toHaveBeenCalled();
    await ledger({ entityType: "worker", entityId: "w", accountId: "cobra" });
    expect(mocks.update).toHaveBeenCalledOnce();
    await mocks.handlers.get("bao-cobra-lifecycle-case")!({ operation: "deleted", coveredPersonWorkerId: "w" });
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
