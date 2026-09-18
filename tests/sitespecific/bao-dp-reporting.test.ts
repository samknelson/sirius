import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerTrustElection } from "@shared/schema/trust/elections-schema";
import type { BaoDpTierTransition } from "@shared/schema/sitespecific/bao/schema";

type Election = Pick<WorkerTrustElection, "id" | "workerId" | "relationshipIds" | "benefitIds">;
type Relation = { id: string; worker1: string; worker2: string; relationTypeName: string };
let relations: Relation[] = [];
let elections: Election[] = [];
let presence: { workerId: string; benefitId: string; year: number; month: number }[] = [];
let entries: { referenceId: string; amount: string; data: Record<string, string> }[] = [];
let balances: { entityId: string; accountId: string; total: string }[] = [];
const rates = [
  { benefitId: "medical", tierTransition: "single_to_2party", rate: "10.00", provisional: false },
  { benefitId: "medical", tierTransition: "2party_to_family", rate: "20.00", provisional: false },
  { benefitId: "medical", tierTransition: "family_to_family_dp", rate: "0.00", provisional: false },
  { benefitId: "provisional", tierTransition: "single_to_2party", rate: "0.00", provisional: true },
  { benefitId: "second", tierTransition: "single_to_2party", rate: "30.00", provisional: false },
];
const storage = {
  workerRelations: {
    searchWorkerRelations: vi.fn(async () => relations),
    listByIdsWithType: vi.fn(async (ids: string[]) => relations.filter((r) => ids.includes(r.id))),
  },
  workerTrustElections: {
    getActiveByWorkersAsOf: vi.fn(async (ids: string[]) => elections.filter((e) => ids.includes(e.workerId) && !e.id.startsWith("old-"))),
    getActiveByWorkerAsOf: vi.fn(async (id: string) => elections.find((e) => e.workerId === id && !e.id.startsWith("old-"))),
    listByWorker: vi.fn(async (id: string) => elections.filter((e) => e.workerId === id)),
    search: vi.fn(async ({ workerIds }: { workerIds: string[] }) => elections.filter((e) => workerIds.includes(e.workerId))),
  },
  trust: { wmb: {
    getWorkersBenefitPresenceForMonth: vi.fn(async (ids: string[], year: number, month: number) =>
      presence.filter((p) => ids.includes(p.workerId) && p.year === year && p.month === month)),
    getWorkerBenefitPresence: vi.fn(async (id: string) => presence.filter((p) => p.workerId === id)),
  } },
  workers: {
    getWorkerDisplayNames: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, `Worker ${id}`]))),
    getWorkerDisplayName: vi.fn(async (id: string) => `Worker ${id}`),
  },
  baoDpRates: {
    getEffectiveRatesForMonth: vi.fn(async () => rates),
    getEffectiveRate: vi.fn(async (benefitId: string, transition: string) =>
      rates.find((r) => r.benefitId === benefitId && r.tierTransition === transition)),
  },
  pluginConfigs: { search: vi.fn(async () => [{ id: "cfg", account: "acct" }]) },
  ledger: { entries: {
    getBalancesByEntityAndAccount: vi.fn(async (_type: string, ids: string[]) =>
      balances.filter((b) => ids.includes(b.entityId))),
    getByReferenceAndConfig: vi.fn(async (id: string) => entries.filter((e) => e.referenceId === id)),
    getByReferencesAndConfig: vi.fn(async (ids: string[]) => entries.filter((e) => ids.includes(e.referenceId))),
  } },
};
vi.mock("../../server/storage", () => ({ storage }));
vi.mock("../../server/storage/database", () => ({ storage }));
vi.mock("../../server/plugins/ledger/charge/charge-config-resolution", () => ({
  toChargeConfig: (c: unknown) => c,
  pickFirstByAccountOrder: (cs: unknown[]) => cs[0],
}));

import type { DpReportWorker } from "../../server/services/sitespecific/bao/dp-reporting";
import { isDpRelationTypeName } from "@shared/sitespecific/bao/dp-relation-types";
const { calculateDpCurrentMonthReport, DP_REPORT_STATUSES } = await import("../../server/services/sitespecific/bao/dp-reporting");
const { priceDpMonth, resolveDpTierTransition } = await import("../../server/modules/sitespecific/bao/dp-pricing");
const { computeDpPaymentState } = await import("../../server/modules/sitespecific/bao/dp-payment-state");

function seed(copies: number) {
  relations = []; elections = []; presence = []; entries = []; balances = [];
  for (let n = 0; n < copies; n++) {
    for (const scenario of ["paid", "partial", "unpaid", "free", "missing", "provisional", "ambiguous", "absent", "child", "unelected"]) {
      const id = `${scenario}-${n}`;
      const rel = { id: `r-${id}`, worker1: id, worker2: `p-${id}`, relationTypeName: scenario === "child" ? "Domestic Partner Child" : "Domestic Partner" };
      relations.push(rel);
      const children = scenario === "free" ? 2 : scenario === "partial" ? 1 : 0;
      for (let i = 0; i < children; i++) relations.push({ id: `c${i}-${id}`, worker1: id, worker2: `cp${i}-${id}`, relationTypeName: "Child" });
      const benefitIds = scenario === "missing" ? ["ancillary"] : scenario === "provisional" ? ["provisional"] : scenario === "ambiguous" ? ["medical", "second"] : ["medical", "ancillary"];
      elections.push({ id: `e-${id}`, workerId: id, relationshipIds: scenario === "unelected" ? [] : [rel.id, ...Array.from({ length: children }, (_, i) => `c${i}-${id}`)], benefitIds });
      presence.push(...benefitIds.map((benefitId) => ({ workerId: id, benefitId, year: 2026, month: scenario === "absent" ? 3 : 4 })));
      if (["paid", "partial", "unpaid"].includes(scenario)) {
        // Old charges plus a reversed charge: only the surviving $5 consumes FIFO credit.
        elections.push({ id: `old-${id}`, workerId: id, relationshipIds: [], benefitIds: [] });
        entries.push(
          { referenceId: `old-${id}`, amount: "5.00", data: { billingMonth: "2026-02", dpRelationshipId: rel.id } },
          { referenceId: `old-${id}`, amount: "9.00", data: { billingMonth: "2026-03", dpRelationshipId: rel.id } },
          { referenceId: `old-${id}`, amount: "-9.00", data: { billingMonth: "2026-03", dpRelationshipId: rel.id } },
          { referenceId: `e-${id}`, amount: scenario === "partial" ? "20.00" : "10.00", data: { billingMonth: "2026-04", dpRelationshipId: rel.id, dpWorkerId: rel.worker2 } },
        );
        balances.push({ entityId: id, accountId: "acct", total: scenario === "paid" ? "0.00" : "15.00" });
      }
    }
  }
}

/** Original per-relation read path, using the real authoritative pricing/FIFO. */
async function authoritativeRows(): Promise<DpReportWorker[]> {
  const rows: DpReportWorker[] = [];
  for (const relation of relations) {
    if (!isDpRelationTypeName(relation.relationTypeName)) continue;
    const election = await storage.workerTrustElections.getActiveByWorkerAsOf(relation.worker1);
    if (!election?.relationshipIds?.includes(relation.id)) continue;
    const types = new Map((await storage.workerRelations.listByIdsWithType(election.relationshipIds)).map((r) => [r.id, r.relationTypeName]));
    const transition: BaoDpTierTransition = resolveDpTierTransition(election, (id) => types.get(id));
    const presence = await storage.trust.wmb.getWorkerBenefitPresence(relation.worker1);
    const price = await priceDpMonth((election.benefitIds ?? []).filter((id) => presence.some((p) => p.benefitId === id && p.year === 2026 && p.month === 4)), transition, "2026-04");
    const payment = await computeDpPaymentState(relation.worker1);
    const month = payment?.months.find((m) => m.month === "2026-04" && m.electionId === election.id && m.dpRelationshipId === relation.id);
    const charge = price.kind === "charge" ? price.amount : "0.00";
    const paidAmount = price.kind === "no_charge" ? "0.00" : month?.paidAmount ?? "0.00";
    rows.push({
      workerId: relation.worker1, workerName: `Worker ${relation.worker1}`,
      partnerWorkerId: relation.worker2, partnerName: `Worker ${relation.worker2}`,
      electionId: election.id, relationshipId: relation.id, coverageMonth: "2026-04",
      charge, paidAmount, balance: Math.max(0, Number(charge) - Number(paidAmount)).toFixed(2),
      status: price.kind === "no_charge" ? "confirmed_no_charge" : price.kind !== "charge" ? "unavailable_not_covered" : month?.status === "paid" ? "paid_covered" : month?.status === "partial" ? "partially_paid" : "unpaid_not_covered",
    });
  }
  return rows;
}

const bulkReads = [
  storage.workerRelations.searchWorkerRelations, storage.workerRelations.listByIdsWithType,
  storage.workerTrustElections.getActiveByWorkersAsOf, storage.workerTrustElections.search,
  storage.trust.wmb.getWorkersBenefitPresenceForMonth, storage.workers.getWorkerDisplayNames,
  storage.baoDpRates.getEffectiveRatesForMonth, storage.pluginConfigs.search,
  storage.ledger.entries.getBalancesByEntityAndAccount, storage.ledger.entries.getByReferencesAndConfig,
];
beforeEach(() => vi.clearAllMocks());

describe("BAO Domestic Partner current-month report", () => {
  it("matches authoritative rows, every status-filtered list, and summary totals", async () => {
    seed(1);
    const expected = await authoritativeRows();
    const report = await calculateDpCurrentMonthReport("2026-04-15");
    expect(report.rows).toEqual(expected);
    for (const status of DP_REPORT_STATUSES) {
      expect(report.rows.filter((r) => r.status === status)).toEqual(expected.filter((r) => r.status === status));
      expect(report.statusCounts[status]).toBe(expected.filter((r) => r.status === status).length);
    }
    expect(report.statusCounts).toEqual({ paid_covered: 1, partially_paid: 1, unpaid_not_covered: 1, confirmed_no_charge: 1, unavailable_not_covered: 4 });
    expect(report.totalActiveWorkers).toBe(8);
    expect([report.totalCharges, report.totalPaid, report.totalBalance]).toEqual(["40.00", "15.00", "25.00"]);
    expect(storage.baoDpRates.getEffectiveRatesForMonth).toHaveBeenCalledWith("2026-04-01");
    expect(storage.trust.wmb.getWorkersBenefitPresenceForMonth).toHaveBeenCalledWith(expect.any(Array), 2026, 4);
  });

  it("uses the same bulk read count for 8 and 800 displayed rows, never per-row reads", async () => {
    const counts: number[] = [];
    for (const copies of [1, 100]) {
      seed(copies);
      vi.clearAllMocks();
      const report = await calculateDpCurrentMonthReport("2026-04-15");
      expect(report.rows).toHaveLength(8 * copies);
      expect(report.totalCharges).toBe((40 * copies).toFixed(2));
      for (const read of bulkReads) expect(read).toHaveBeenCalledTimes(1);
      counts.push(bulkReads.reduce((sum, read) => sum + read.mock.calls.length, 0));
      expect(storage.workerTrustElections.getActiveByWorkerAsOf).not.toHaveBeenCalled();
      expect(storage.workerTrustElections.listByWorker).not.toHaveBeenCalled();
      expect(storage.trust.wmb.getWorkerBenefitPresence).not.toHaveBeenCalled();
      expect(storage.baoDpRates.getEffectiveRate).not.toHaveBeenCalled();
      expect(storage.workers.getWorkerDisplayName).not.toHaveBeenCalled();
      expect(storage.ledger.entries.getByReferenceAndConfig).not.toHaveBeenCalled();
    }
    expect(counts).toEqual([10, 10]);
  });

  it("returns an empty summary without loading pricing, payments or names", async () => {
    seed(0);
    const report = await calculateDpCurrentMonthReport("2026-04-15");
    expect(report.rows).toEqual([]);
    expect(report.totalBalance).toBe("0.00");
    expect(storage.pluginConfigs.search).not.toHaveBeenCalled();
    expect(storage.baoDpRates.getEffectiveRatesForMonth).not.toHaveBeenCalled();
    expect(storage.workers.getWorkerDisplayNames).not.toHaveBeenCalled();
  });
});