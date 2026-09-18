import { describe, expect, it, vi } from "vitest";

const storage = {
  workerRelations: {
    searchWorkerRelations: vi.fn(),
    listByIdsWithType: vi.fn(),
  },
  workerTrustElections: { getActiveByWorkerAsOf: vi.fn() },
  trust: { wmb: { getWorkerBenefitPresence: vi.fn() } },
  workers: { getWorkerDisplayName: vi.fn(async (id: string) => `Worker ${id}`) },
};

vi.mock("../../server/storage", () => ({ storage }));
vi.mock("../../server/modules/sitespecific/bao/dp-pricing", () => ({
  resolveDpTierTransition: vi.fn(() => "single_to_2party"),
  priceDpMonth: vi.fn(async (ids: string[]) => {
    const id = ids[0];
    if (id === "free") return { kind: "no_charge", benefitId: id };
    if (id === "missing" || id === "provisional") return { kind: "missing_rate", ratedBenefitIds: [id] };
    return { kind: "charge", amount: id === "partial" ? "20.00" : "10.00", benefitId: id, lineRates: { [id]: id === "partial" ? "20.00" : "10.00" } };
  }),
}));
vi.mock("../../server/modules/sitespecific/bao/dp-payment-state", () => ({
  computeDpPaymentState: vi.fn(async (workerId: string) => {
    const status = workerId === "paid" ? "paid" : workerId === "partial" ? "partial" : "unpaid";
    return {
      accountId: "acct", configId: "cfg", balance: "0.00", totalCharges: "0.00", totalPaid: "0.00",
      months: status === "unpaid" ? [] : [{ month: "2026-04", electionId: `e-${workerId}`, dpRelationshipId: `r-${workerId}`, dpWorkerId: `p-${workerId}`, netCharge: workerId === "partial" ? "20.00" : "10.00", paidAmount: workerId === "partial" ? "5.00" : "10.00", status }],
    };
  }),
}));

describe("BAO Domestic Partner current-month report", () => {
  it("selects active subscriber relations/elections, excludes DP children, classifies all statuses, and aggregates money", async () => {
    const ids = ["paid", "partial", "unpaid", "free", "missing", "provisional", "child"];
    storage.workerRelations.searchWorkerRelations.mockResolvedValue(
      ids.map((id) => ({
        id: `r-${id}`, worker1: id, worker2: `p-${id}`,
        relationTypeName: id === "child" ? "Domestic Partner Child" : "Domestic Partner",
      })),
    );
    storage.workerTrustElections.getActiveByWorkerAsOf.mockImplementation(async (id: string) =>
      id === "child" ? undefined : { id: `e-${id}`, workerId: id, relationshipIds: [`r-${id}`], benefitIds: [id] },
    );
    storage.workerRelations.listByIdsWithType.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, relationTypeName: "Domestic Partner" })),
    );
    storage.trust.wmb.getWorkerBenefitPresence.mockImplementation(async (id: string) => [
      { benefitId: id, year: 2026, month: 4 },
    ]);

    const { calculateDpCurrentMonthReport } = await import("../../server/services/sitespecific/bao/dp-reporting");
    const report = await calculateDpCurrentMonthReport("2026-04-15");

    expect(storage.workerRelations.searchWorkerRelations).toHaveBeenCalledWith(expect.objectContaining({ role: "worker_1", activeAt: expect.any(Date) }));
    expect(storage.workerTrustElections.getActiveByWorkerAsOf).toHaveBeenCalledWith("paid", "2026-04-15");
    expect(report.rows.map((r) => r.status)).toEqual([
      "paid_covered", "partially_paid", "unpaid_not_covered", "confirmed_no_charge",
      "unavailable_not_covered", "unavailable_not_covered",
    ]);
    expect(report.statusCounts).toEqual({
      paid_covered: 1, partially_paid: 1, unpaid_not_covered: 1,
      confirmed_no_charge: 1, unavailable_not_covered: 2,
    });
    expect(report.totalCharges).toBe("40.00");
    expect(report.totalPaid).toBe("15.00");
    expect(report.totalBalance).toBe("25.00");
  });
});