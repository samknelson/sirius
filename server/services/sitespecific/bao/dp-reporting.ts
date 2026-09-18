import { storage } from "../../../storage";
import { getTodayYmd } from "@shared/utils/date";
import { resolveDpTierTransition, priceDpRatedBenefits } from "../../../modules/sitespecific/bao/dp-pricing";
import { isDpRelationTypeName } from "@shared/sitespecific/bao/dp-relation-types";
import { computeDpPaymentStates, type DpPaymentStateResult } from "../../../modules/sitespecific/bao/dp-payment-state";

export type DpReportStatus =
  | "paid_covered"
  | "partially_paid"
  | "unpaid_not_covered"
  | "confirmed_no_charge"
  | "unavailable_not_covered";

export interface DpReportWorker {
  workerId: string;
  workerName: string;
  partnerWorkerId: string;
  partnerName: string;
  electionId: string;
  relationshipId: string;
  coverageMonth: string;
  charge: string;
  paidAmount: string;
  balance: string;
  status: DpReportStatus;
}

export interface DpReportResult {
  asOfYmd: string;
  currentMonth: string;
  rows: DpReportWorker[];
  totalActiveWorkers: number;
  totalCharges: string;
  totalPaid: string;
  totalBalance: string;
  statusCounts: Record<DpReportStatus, number>;
}

export const DP_REPORT_STATUSES: DpReportStatus[] = [
  "paid_covered",
  "partially_paid",
  "unpaid_not_covered",
  "confirmed_no_charge",
  "unavailable_not_covered",
];

const money = (n: number) => Number(n.toFixed(2)).toFixed(2);

/**
 * Authoritative read-time DP population and billing report. Both the summary
 * and list endpoints consume this exact calculation, preventing the dashboard
 * from drifting from the operational list.
 */
export async function calculateDpCurrentMonthReport(
  asOfYmd = getTodayYmd(),
): Promise<DpReportResult> {
  const asOfDate = new Date(`${asOfYmd}T00:00:00Z`);
  const currentMonth = asOfYmd.slice(0, 7);
  const relations = (await storage.workerRelations.searchWorkerRelations({
    role: "worker_1",
    activeAt: asOfDate,
    relationTypeNameILike: "%domestic partner%",
  })).filter((r) => isDpRelationTypeName(r.relationTypeName));
  const elections = await storage.workerTrustElections.getActiveByWorkersAsOf(
    [...new Set(relations.map((r) => r.worker1))],
    asOfYmd,
  );
  const electionByWorker = new Map(elections.map((e) => [e.workerId, e]));
  const electedRelations = relations.filter((r) =>
    electionByWorker.get(r.worker1)?.relationshipIds?.includes(r.id),
  );
  const workerIds = [...new Set(electedRelations.map((r) => r.worker1))];
  const [allRelations, presence, rates, payments, names] = workerIds.length
    ? await Promise.all([
        storage.workerRelations.listByIdsWithType(
          [...new Set(elections.flatMap((e) => e.relationshipIds ?? []))],
        ),
        storage.trust.wmb.getWorkersBenefitPresenceForMonth(
          workerIds, Number(asOfYmd.slice(0, 4)), Number(asOfYmd.slice(5, 7)),
        ),
        storage.baoDpRates.getEffectiveRatesForMonth(`${currentMonth}-01`),
        computeDpPaymentStates(workerIds),
        storage.workers.getWorkerDisplayNames(
          [...new Set(electedRelations.flatMap((r) => [r.worker1, r.worker2]))],
        ),
      ])
    : [[], [], [], new Map<string, DpPaymentStateResult | null>(), new Map<string, string>()] as const;
  const relationTypes = new Map(allRelations.map((r) => [r.id, r.relationTypeName]));
  const presentByWorker = new Map<string, Set<string>>();
  for (const p of presence) {
    const benefits = presentByWorker.get(p.workerId) ?? new Set<string>();
    benefits.add(p.benefitId);
    presentByWorker.set(p.workerId, benefits);
  }
  const rateByKey = new Map(rates.map((r) => [`${r.benefitId}:${r.tierTransition}`, r]));
  const rows: DpReportWorker[] = [];
  const seen = new Set<string>();

  for (const relation of electedRelations) {
    const election = electionByWorker.get(relation.worker1)!;
    const transition = resolveDpTierTransition(election, (id) => relationTypes.get(id));
    const presentBenefitIds = (election.benefitIds ?? []).filter((id) =>
      presentByWorker.get(relation.worker1)?.has(id),
    );
    const price = priceDpRatedBenefits(presentBenefitIds.flatMap((id) => {
      const rate = rateByKey.get(`${id}:${transition}`);
      return rate ? [{ benefitId: id, rate: rate.rate, provisional: !!rate.provisional }] : [];
    }));
    const payment = payments.get(relation.worker1);
    const paymentMonth = payment?.months.find(
      (m) => m.electionId === election.id && m.dpRelationshipId === relation.id && m.month === asOfYmd.slice(0, 7),
    );
    const key = `${relation.worker1}:${relation.id}:${election.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let charge = "0.00";
    let paidAmount = paymentMonth?.paidAmount ?? "0.00";
    let status: DpReportStatus;
    if (price.kind === "no_charge") {
      status = "confirmed_no_charge";
      paidAmount = "0.00";
    } else if (price.kind !== "charge") {
      status = "unavailable_not_covered";
    } else {
      charge = price.amount;
      if (paymentMonth?.status === "paid") status = "paid_covered";
      else if (paymentMonth?.status === "partial") status = "partially_paid";
      else status = "unpaid_not_covered";
    }

    rows.push({
      workerId: relation.worker1,
      workerName: names.get(relation.worker1)!,
      partnerWorkerId: relation.worker2,
      partnerName: names.get(relation.worker2)!,
      electionId: election.id,
      relationshipId: relation.id,
      coverageMonth: asOfYmd.slice(0, 7),
      charge,
      paidAmount,
      balance: money(Math.max(0, Number(charge) - Number(paidAmount))),
      status,
    });
  }

  const statusCounts = Object.fromEntries(DP_REPORT_STATUSES.map((s) => [s, 0])) as Record<DpReportStatus, number>;
  for (const row of rows) statusCounts[row.status]++;
  return {
    asOfYmd,
    currentMonth: asOfYmd.slice(0, 7),
    rows,
    totalActiveWorkers: rows.length,
    totalCharges: money(rows.reduce((s, r) => s + Number(r.charge), 0)),
    totalPaid: money(rows.reduce((s, r) => s + Number(r.paidAmount), 0)),
    totalBalance: money(rows.reduce((s, r) => s + Number(r.balance), 0)),
    statusCounts,
  };
}