import { storage } from "../../../storage";
import { getTodayYmd } from "@shared/utils/date";
import { resolveDpTierTransition, priceDpMonth } from "../../../modules/sitespecific/bao/dp-pricing";
import { isDpRelationTypeName } from "@shared/sitespecific/bao/dp-relation-types";
import { computeDpPaymentState } from "../../../modules/sitespecific/bao/dp-payment-state";

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
  const relations = await storage.workerRelations.searchWorkerRelations({
    role: "worker_1",
    activeAt: asOfDate,
    relationTypeNameILike: "%domestic partner%",
  });
  const rows: DpReportWorker[] = [];
  const seen = new Set<string>();

  for (const relation of relations) {
    if (!isDpRelationTypeName(relation.relationTypeName)) continue;
    const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
      relation.worker1,
      asOfYmd,
    );
    if (!election || !(election.relationshipIds ?? []).includes(relation.id)) continue;
    const allRelations = await storage.workerRelations.listByIdsWithType(
      election.relationshipIds ?? [],
    );
    const byId = new Map(allRelations.map((r) => [r.id, r.relationTypeName]));
    const transition = resolveDpTierTransition(election, (id) => byId.get(id));
    const presence = await storage.trust.wmb.getWorkerBenefitPresence(relation.worker1);
    const presentBenefitIds = (election.benefitIds ?? []).filter((id) =>
      presence.some(
        (p) =>
          p.benefitId === id &&
          `${p.year}-${String(p.month).padStart(2, "0")}` === asOfYmd.slice(0, 7),
      ),
    );
    const price = await priceDpMonth(presentBenefitIds, transition, asOfYmd.slice(0, 7));
    const payment = await computeDpPaymentState(relation.worker1);
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

    const [workerName, partnerName] = await Promise.all([
      storage.workers.getWorkerDisplayName(relation.worker1),
      storage.workers.getWorkerDisplayName(relation.worker2),
    ]);
    rows.push({
      workerId: relation.worker1,
      workerName,
      partnerWorkerId: relation.worker2,
      partnerName,
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