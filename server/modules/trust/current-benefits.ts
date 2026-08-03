import { storage } from "../../storage";
import type { WorkerBenefitPresenceRow } from "../../storage/trust/wmb";

export interface CurrentBenefitRow {
  benefitId: string;
  benefitName: string | null;
  benefitType: {
    id: string | null;
    name: string | null;
    color: string | null;
    icon: string | null;
    sequence: number | null;
  };
  activeSinceYear: number;
  activeSinceMonth: number;
  electedOn: string | null;
  activeInCurrentMonth: boolean;
  endDate: string | null;
  /** Set when the most-recent-month coverage came through a relationship (dependent coverage). */
  sourceRelation: {
    id: string;
    relationTypeName: string | null;
    sourceWorkerId: string;
    sourceWorkerName: string;
  } | null;
}

function periodKey(year: number, month: number): number {
  return year * 12 + month;
}

function yearFromPeriodKey(key: number): number {
  return Math.floor((key - 1) / 12);
}

function monthFromPeriodKey(key: number): number {
  return ((key - 1) % 12) + 1;
}

function lastDayOfMonthYmd(year: number, month: number): string {
  // month is 1-based; day 0 of next month = last day of this month.
  const d = new Date(Date.UTC(year, month, 0));
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

/**
 * Compute the "Current benefits" summary for a worker.
 *
 * Rules (see task spec):
 * - M* = the most recent recorded month across all of the worker's trust_wmb rows.
 * - Current benefits = distinct benefitIds present in M* (combined across employers).
 * - Active Since = the first month of the unbroken monthly run ending at M*
 *   (any missing month is a break).
 * - Elected On = earliest election start date whose benefit_ids contains the benefit.
 * - Active in current month = whether M* equals today's calendar year/month;
 *   when false, every row is dimmed on the client and shows an End Date (end of M*).
 * - Ordering = benefit type sequence, then benefit name.
 */
export async function getWorkerCurrentBenefits(workerId: string): Promise<CurrentBenefitRow[]> {
  const presence: WorkerBenefitPresenceRow[] = await storage.trust.wmb.getWorkerBenefitPresence(workerId);
  if (presence.length === 0) return [];

  // Most recent recorded month across the whole worker.
  let mStar = -Infinity;
  for (const row of presence) {
    const key = periodKey(row.year, row.month);
    if (key > mStar) mStar = key;
  }

  // Per-benefit set of present period keys + metadata (metadata is constant per benefit).
  const presentByBenefit = new Map<string, Set<number>>();
  const metaByBenefit = new Map<string, WorkerBenefitPresenceRow>();
  // Source relation of the most-recent-month (M*) row per benefit. When a
  // benefit has multiple M* rows (e.g. across employers), prefer a non-null
  // relation id so dependent coverage isn't hidden by a duplicate own row.
  const sourceRelationIdByBenefit = new Map<string, string | null>();
  for (const row of presence) {
    let set = presentByBenefit.get(row.benefitId);
    if (!set) {
      set = new Set<number>();
      presentByBenefit.set(row.benefitId, set);
    }
    set.add(periodKey(row.year, row.month));
    if (!metaByBenefit.has(row.benefitId)) metaByBenefit.set(row.benefitId, row);
    if (periodKey(row.year, row.month) === mStar) {
      const existing = sourceRelationIdByBenefit.get(row.benefitId);
      if (!existing) sourceRelationIdByBenefit.set(row.benefitId, row.sourceRelationId);
    }
  }

  // Current benefits = those present at M*.
  const currentBenefitIds: string[] = [];
  for (const [benefitId, set] of Array.from(presentByBenefit.entries())) {
    if (set.has(mStar)) currentBenefitIds.push(benefitId);
  }
  if (currentBenefitIds.length === 0) return [];

  // Earliest election start date per benefit (pure TS composition over storage reads).
  const elections = await storage.workerTrustElections.listByWorker(workerId);
  const earliestElectionByBenefit = new Map<string, string>();
  for (const election of elections) {
    if (!election.startYmd) continue;
    for (const benefitId of election.benefitIds ?? []) {
      const current = earliestElectionByBenefit.get(benefitId);
      if (!current || election.startYmd < current) {
        earliestElectionByBenefit.set(benefitId, election.startYmd);
      }
    }
  }

  // Resolve source relations (dependent coverage) for the M* rows. The
  // worker_relations table is owned by the optional worker.relations
  // component, so only resolve when it is enabled; otherwise sourceRelation
  // stays null.
  const { isComponentEnabledSync } = await import("../../services/component-cache");
  const relationIds = Array.from(
    new Set(
      currentBenefitIds
        .map((benefitId) => sourceRelationIdByBenefit.get(benefitId) ?? null)
        .filter((id): id is string => !!id),
    ),
  );
  const sourceRelationById = new Map<
    string,
    { id: string; relationTypeName: string | null; sourceWorkerId: string; sourceWorkerName: string }
  >();
  if (relationIds.length > 0 && isComponentEnabledSync("worker.relations")) {
    const relations = await storage.workerRelations.listByIdsWithType(relationIds);
    const nameByWorkerId = new Map<string, string>();
    for (const rel of relations) {
      if (!nameByWorkerId.has(rel.worker1)) {
        nameByWorkerId.set(rel.worker1, await storage.workers.getWorkerDisplayName(rel.worker1));
      }
      sourceRelationById.set(rel.id, {
        id: rel.id,
        relationTypeName: rel.relationTypeName,
        sourceWorkerId: rel.worker1,
        sourceWorkerName: nameByWorkerId.get(rel.worker1) ?? rel.worker1,
      });
    }
  }

  const now = new Date();
  const currentPeriodKey = periodKey(now.getFullYear(), now.getMonth() + 1);
  const activeInCurrentMonth = mStar === currentPeriodKey;
  const endDate = activeInCurrentMonth
    ? null
    : lastDayOfMonthYmd(yearFromPeriodKey(mStar), monthFromPeriodKey(mStar));

  const rows: CurrentBenefitRow[] = currentBenefitIds.map((benefitId) => {
    const set = presentByBenefit.get(benefitId)!;
    const meta = metaByBenefit.get(benefitId)!;

    // Walk backward from M* while the previous month is present; the first month
    // of the unbroken run is "Active Since".
    let runStart = mStar;
    while (set.has(runStart - 1)) runStart -= 1;

    return {
      benefitId,
      benefitName: meta.benefitName,
      benefitType: {
        id: meta.benefitTypeId,
        name: meta.benefitTypeName,
        color: meta.benefitTypeColor,
        icon: meta.benefitTypeIcon,
        sequence: meta.benefitTypeSequence,
      },
      activeSinceYear: yearFromPeriodKey(runStart),
      activeSinceMonth: monthFromPeriodKey(runStart),
      electedOn: earliestElectionByBenefit.get(benefitId) ?? null,
      activeInCurrentMonth,
      endDate,
      sourceRelation: (() => {
        const relId = sourceRelationIdByBenefit.get(benefitId);
        return relId ? sourceRelationById.get(relId) ?? null : null;
      })(),
    };
  });

  // Ordering: benefit type sequence (nulls last), then benefit name.
  rows.sort((a, b) => {
    const seqA = a.benefitType.sequence ?? Number.MAX_SAFE_INTEGER;
    const seqB = b.benefitType.sequence ?? Number.MAX_SAFE_INTEGER;
    if (seqA !== seqB) return seqA - seqB;
    return (a.benefitName ?? "").localeCompare(b.benefitName ?? "");
  });

  return rows;
}
