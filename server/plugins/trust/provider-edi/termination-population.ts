import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { trustWmb, trustWmbEvents, trustWmbScanQueue, workerRelations, employers } from "@shared/schema";
import { assertUnambiguousMonth } from "./coverage-segments";
import { competingSources, correctionRequired, relationCoversMonth, type EvidenceRow, type ExcludedGroup } from "./coverage-conflicts";
import { requireSegmentStart, resolveSegmentStarts } from "./coverage-starts";
import { CoverageBudget, readBudgetedPages } from "./coverage-budget";
import type { TrustProviderEdiContext } from "./registry";
import {
  monthIndex, monthParts, monthStart, monthEnd, readTerminationPolicy, terminationWindow,
} from "./termination-policy";
import { readAsOfYmd } from "./base";
import { readTerminationQuery } from "./termination-query";

export type Coverage = Pick<typeof trustWmb.$inferSelect,
  "id" | "workerId" | "benefitId" | "year" | "month" | "sourceRelationId" | "employerId"> & { employerSiriusId?: string | null };
export type TermEvent = Pick<typeof trustWmbEvents.$inferSelect,
  "id" | "workerId" | "benefitId" | "year" | "month" | "data">;
export type Relation = Pick<typeof workerRelations.$inferSelect,
  "id" | "worker1" | "worker2" | "startYmd" | "endYmd">;
export interface TerminationCandidate {
  eventId: string;
  benefitId: string;
  workerId: string;
  familyWmbId: string;
  rowKey: string;
  role: "subscriber" | "dependent";
  start: string;
  end: string;
  evidence: "confirmed scan" | "coverage inferred";
}
/** A candidate before its coverage start is read from lifecycle events. */
export type TerminationSelection = Omit<TerminationCandidate, "start"> & { memberWmbId: string };

export interface ScanEvidence {
  workerId: string; year: number; month: number;
  resultSummary: unknown;
}

class MissingLastCoveredWmbError extends Error {
  constructor(readonly event: TermEvent) {
    super("last-covered WMB evidence is missing");
  }
}

async function sourceWorkerNids(ctx: TrustProviderEdiContext, workerId: string): Promise<string[]> {
  return readTerminationQuery(ctx, "Resolving source worker NID", async db => {
    const presence = await db.execute(sql`SELECT to_regclass('s1_staging.id_map') IS NOT NULL AS present`);
    if (!presence.rows[0]?.present) return [];
    const result = await db.execute(sql`
      SELECT s1_id::text AS nid
      FROM s1_staging.id_map
      WHERE entity = 'worker' AND s2_id = ${workerId} AND stub = false
      ORDER BY s1_id
    `);
    return result.rows.map(row => String(row.nid));
  });
}

function missingLastCoveredMessage(event: TermEvent, sourceNids: string[]): string {
  const worker = sourceNids.length === 1
    ? `worker NID ${sourceNids[0]}`
    : sourceNids.length > 1
      ? `worker NIDs ${sourceNids.join(", ")}`
      : `worker NID unavailable (S2 worker ${event.workerId})`;
  return `Termination event ${event.id} for ${worker}: last-covered WMB evidence is missing for ${monthStart(monthIndex(event.year, event.month) - 1)} (benefit ${event.benefitId}). Repair history before generating.`;
}
/** Rows must be newest-first. A parent's unscoped action is never a child's decision. */
export function terminationScanDecisions(events: TermEvent[], scans: ScanEvidence[]) {
  const seen = new Set<string>();
  const latest = scans.filter(scan => {
    const key = `${scan.workerId}|${scan.year}|${scan.month}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const decisions = new Map<string, boolean>();
  for (const event of events) for (const scan of latest) {
    if (scan.year !== event.year || scan.month !== event.month) continue;
    const summary = scan.resultSummary as { actions?: Array<{
      workerId?: string; benefitId?: string; scanType?: string;
      eligible?: boolean; action?: string; executionError?: unknown;
    }> } | null;
    const action = Array.isArray(summary?.actions) ? summary.actions.find(a =>
      !a.executionError && (a.workerId ? a.workerId === event.workerId : scan.workerId === event.workerId) &&
      a.benefitId === event.benefitId) : undefined;
    if (!action) continue;
    decisions.set(event.id, action.scanType === "continue" &&
      (action.eligible === false || action.action === "delete"));
    break;
  }
  return decisions;
}
export function confirmedTerminationIds(events: TermEvent[], scans: ScanEvidence[]) {
  return new Set([...terminationScanDecisions(events, scans)].filter(([, confirmed]) => confirmed).map(([id]) => id));
}

/**
 * Only a retained event plus its last-covered row establishes an ending.
 * Corrections and ANY subsequent coverage suppress it, even a later reinstatement.
 * Family identity comes from the historical WMB source relation, never today's
 * active family. Dangling history is a report error, not an omission.
 *
 * A conflicting last covered month (the person's own, or their subscriber's)
 * never produces a termination: the candidate is returned in `excluded` so the
 * caller can list it, or refuse the run when the temporary rule is off.
 * `coverage` needs only each person's last covered month and their
 * subscriber's records for that month.
 */
export function selectTerminationCandidates(
  events: TermEvent[], coverage: Coverage[], relations: Relation[],
  confirmedEventIds: ReadonlySet<string>, asOf: string,
  policy: ReturnType<typeof readTerminationPolicy>,
  contradictedEventIds: ReadonlySet<string> = new Set(),
): { selected: TerminationSelection[]; excluded: ExcludedGroup[] } {
  const window = terminationWindow(asOf, policy.months);
  const relationMap = new Map(relations.map(r => [r.id, r]));
  const byPerson = new Map<string, Coverage[]>();
  for (const row of coverage) {
    const key = `${row.workerId}|${row.benefitId}`;
    const list = byPerson.get(key) ?? [];
    list.push(row);
    byPerson.set(key, list);
  }
  const selected: TerminationSelection[] = [];
  const excluded: ExcludedGroup[] = [];
  const evidenceRows = (rows: Coverage[]): EvidenceRow[] => [...rows].sort((a, b) => a.id.localeCompare(b.id))
    .map(r => ({ ...r, employerSiriusId: r.employerSiriusId ?? null }));
  for (const event of events) {
    const eventMonth = monthIndex(event.year, event.month);
    const endMonth = eventMonth - 1;
    if (endMonth < window.firstEnd || endMonth > window.lastEnd) continue;
    const history = byPerson.get(`${event.workerId}|${event.benefitId}`) ?? [];
    // A stale end must never override reinstatement, even after the report month.
    if (history.some(r => monthIndex(r.year, r.month) >= eventMonth)) continue;
    const previous = history.filter(r => monthIndex(r.year, r.month) === endMonth);
    if (!previous.length) throw new MissingLastCoveredWmbError(event);
    const roles = new Set(previous.map(r => r.sourceRelationId ? "dependent" : "subscriber"));
    if (![...roles].some(role => role === "subscriber" ? policy.subscribers : policy.dependents)) continue;
    if (competingSources(previous)) {
      excluded.push({ reason: "termination-conflict", rows: evidenceRows(previous) });
      continue;
    }
    const member = [...previous].sort((a, b) => a.id.localeCompare(b.id))[0];
    const role = member.sourceRelationId ? "dependent" : "subscriber";
    const inferred = (event.data as Record<string, unknown> | null)?.provenance === "coverage_inferred";
    if (inferred && contradictedEventIds.has(event.id)) {
      throw new Error(`Termination event ${event.id}: current scan evidence contradicts retained inferred history. Reconcile coverage before generating.`);
    }
    if (!inferred && !confirmedEventIds.has(event.id)) {
      throw new Error(`Termination event ${event.id}: no current failed continuation scan supports this event. Reconcile WMB events before generating.`);
    }
    let family = member;
    if (member.sourceRelationId) {
      const relation = relationMap.get(member.sourceRelationId);
      if (!relationCoversMonth(relation, member)) {
        throw new Error(`Termination event ${event.id}: historical family relation is missing or inconsistent.`);
      }
      const parentRows = (byPerson.get(`${relation.worker1}|${member.benefitId}`) ?? [])
        .filter(r => monthIndex(r.year, r.month) === endMonth);
      if (competingSources(parentRows)) {
        excluded.push({ reason: "termination-subscriber-excluded", rows: evidenceRows(previous) });
        continue;
      }
      const parents = parentRows.filter(r => !r.sourceRelationId);
      if (!parents.length) {
        throw new Error(`Termination event ${event.id}: historical subscriber coverage is missing or ambiguous.`);
      }
      family = parents.sort((a, b) => a.id.localeCompare(b.id))[0];
    }
    selected.push({
      eventId: event.id, benefitId: event.benefitId, workerId: event.workerId,
      familyWmbId: family.id, memberWmbId: member.id,
      rowKey: role === "subscriber" ? family.id : `${family.id}:${member.sourceRelationId}`,
      role, end: monthEnd(endMonth),
      evidence: inferred ? "coverage inferred" : "confirmed scan",
    });
  }
  return { selected: selected.sort((a, b) => a.eventId.localeCompare(b.eventId)), excluded };
}

export interface TerminationEvidence {
  selected: TerminationSelection[];
  excluded: ExcludedGroup[];
  /** Everything the selection was decided from, for the run's fingerprint. */
  events: TermEvent[];
  coverage: EvidenceRow[];
  relations: Relation[];
}

/**
 * Bounded population read. Events come from the termination window and are
 * dropped in the database when ANY later coverage exists; coverage is read for
 * each person's last covered month and their subscriber's records that month.
 * No one's history is loaded.
 */
export async function readTerminationEvidence(
  ctx: TrustProviderEdiContext, benefitIds: string[],
  onBatch?: (done: number, total: number, milliseconds: number) => Promise<void> | void,
  budget = new CoverageBudget(ctx.coverageCorrelation),
): Promise<TerminationEvidence> {
  const empty: TerminationEvidence = { selected: [], excluded: [], events: [], coverage: [], relations: [] };
  const policy = ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData);
  if (!policy.subscribers && !policy.dependents) return empty;
  const asOf = readAsOfYmd(ctx);
  const window = terminationWindow(asOf, policy.months);
  const firstEventMonth = monthParts(window.firstEnd + 1);
  const lastEventMonth = monthParts(window.report);
  const events = await readBudgetedPages(budget, (after, pageSize) => readTerminationQuery(ctx, "Selecting termination events", db => db.select({
    id: trustWmbEvents.id, workerId: trustWmbEvents.workerId, benefitId: trustWmbEvents.benefitId,
    year: trustWmbEvents.year, month: trustWmbEvents.month, data: trustWmbEvents.data,
  }).from(trustWmbEvents).where(and(
    inArray(trustWmbEvents.benefitId, benefitIds), eq(trustWmbEvents.eventType, "terminate"),
    after ? gt(trustWmbEvents.id, after) : undefined,
    sql`(${trustWmbEvents.year}, ${trustWmbEvents.month}) BETWEEN
      (${firstEventMonth.year}, ${firstEventMonth.month}) AND (${lastEventMonth.year}, ${lastEventMonth.month})`,
    // Reinstatement in ANY later month, from any source, retires the ending.
    sql`NOT EXISTS (SELECT 1 FROM ${trustWmb} later WHERE later.worker_id = ${trustWmbEvents.workerId}
      AND later.benefit_id = ${trustWmbEvents.benefitId}
      AND (later.year, later.month) >= (${trustWmbEvents.year}, ${trustWmbEvents.month}))`,
  )).orderBy(trustWmbEvents.id).limit(pageSize), budget));
  const result: TerminationEvidence = { ...empty, events };
  const endMonths = (batch: TermEvent[]) => [...new Set(batch.map(e => monthIndex(e.year, e.month) - 1))];
  const coverageColumns = {
    id: trustWmb.id, workerId: trustWmb.workerId, benefitId: trustWmb.benefitId, year: trustWmb.year,
    month: trustWmb.month, employerId: trustWmb.employerId, sourceRelationId: trustWmb.sourceRelationId,
    employerSiriusId: employers.siriusId,
  };
  for (let offset = 0; offset < events.length; offset += 100) {
    const started = performance.now();
    const batch = events.slice(offset, offset + 100);
    const workerIds = [...new Set(batch.map(e => e.workerId))];
    const months = endMonths(batch);
    const years = [...new Set(months.map(m => Math.floor(m / 12)))];
    const monthFilter = and(inArray(trustWmb.benefitId, benefitIds), inArray(trustWmb.year, years),
      sql`${trustWmb.year} * 12 + ${trustWmb.month} - 1 IN (${sql.join(months.map(m => sql`${m}`), sql`, `)})`);
    const ended = new Set(batch.map(e => `${e.workerId}|${e.benefitId}|${monthIndex(e.year, e.month) - 1}`));
    const coverage: EvidenceRow[] = (await readBudgetedPages(budget, (after, pageSize) => readTerminationQuery(ctx, "Reading last-covered rows", db => db.select(coverageColumns).from(trustWmb)
      .leftJoin(employers, eq(trustWmb.employerId, employers.id))
      .where(and(inArray(trustWmb.workerId, workerIds), monthFilter, after ? gt(trustWmb.id, after) : undefined))
      .orderBy(trustWmb.id).limit(pageSize), budget)))
      .filter(r => ended.has(`${r.workerId}|${r.benefitId}|${monthIndex(r.year, r.month)}`));
    const relationIds = [...new Set(coverage.map(r => r.sourceRelationId).filter((v): v is string => !!v))];
    const relations = relationIds.length ? await readBudgetedPages(budget, (after, pageSize) => readTerminationQuery(ctx, "Reading historical relationships", db =>
      db.select().from(workerRelations).where(and(inArray(workerRelations.id, relationIds),
        after ? gt(workerRelations.id, after) : undefined)).orderBy(workerRelations.id).limit(pageSize), budget)) : [];
    const relationById = new Map(relations.map(r => [r.id, r]));
    const parentMonths = new Set(coverage.flatMap(r => {
      const parent = r.sourceRelationId && relationById.get(r.sourceRelationId)?.worker1;
      return parent ? [`${parent}|${r.benefitId}|${monthIndex(r.year, r.month)}`] : [];
    }));
    const parentIds = [...new Set([...parentMonths].map(key => key.split("|")[0]))];
    const known = new Set(coverage.map(r => r.id));
    if (parentIds.length) for (const row of await readBudgetedPages(budget, (after, pageSize) => readTerminationQuery(ctx, "Reading historical subscriber rows", db => db.select(coverageColumns).from(trustWmb)
      .leftJoin(employers, eq(trustWmb.employerId, employers.id))
      .where(and(inArray(trustWmb.workerId, parentIds), monthFilter, after ? gt(trustWmb.id, after) : undefined))
      .orderBy(trustWmb.id).limit(pageSize), budget))) {
      if (parentMonths.has(`${row.workerId}|${row.benefitId}|${monthIndex(row.year, row.month)}`) && !known.has(row.id)) coverage.push(row);
    }
    // Parent scans can carry individual dependent decisions. Load once per
    // batch, not once per person. Newest attempts supersede older summaries.
    const scans = await readTerminationQuery(ctx, "Reading continuation scan summaries", db => db.select({
      workerId: trustWmbScanQueue.workerId, year: trustWmbScanQueue.year,
      month: trustWmbScanQueue.month, resultSummary: trustWmbScanQueue.resultSummary,
    }).from(trustWmbScanQueue).where(and(
      inArray(trustWmbScanQueue.status, ["success", "failed"]),
      isNotNull(trustWmbScanQueue.resultSummary),
      sql`${trustWmbScanQueue.year} * 12 + ${trustWmbScanQueue.month} - 1 BETWEEN ${window.firstEnd + 1} AND ${window.report}`,
      or(inArray(trustWmbScanQueue.workerId, workerIds),
        ...workerIds.map(id => sql`(${trustWmbScanQueue.resultSummary}->'people') @> jsonb_build_array(jsonb_build_object('workerId', ${id}::text))`)),
    )).orderBy(desc(trustWmbScanQueue.completedAt), desc(trustWmbScanQueue.id)).limit(5001), budget);
    if (scans.length > 5000) throw new Error("Termination scan evidence exceeded its safe resource budget. No partial generation is available; ask an administrator to inspect scan history.");
    for (const scan of scans) budget.retain(scan);
    const confirmed = confirmedTerminationIds(batch, scans);
    const contradicted = new Set([...terminationScanDecisions(batch, scans)]
      .filter(([, decision]) => !decision).map(([id]) => id));
    let selection: ReturnType<typeof selectTerminationCandidates>;
    try {
      selection = selectTerminationCandidates(batch, coverage, relations, confirmed, asOf, policy, contradicted);
    } catch (error) {
      if (error instanceof MissingLastCoveredWmbError) {
        throw new Error(missingLastCoveredMessage(error.event, await sourceWorkerNids(ctx, error.event.workerId)));
      }
      throw error;
    }
    const { selected, excluded } = selection;
    result.selected.push(...selected);
    result.excluded.push(...excluded);
    result.coverage.push(...coverage);
    result.relations.push(...relations);
    await onBatch?.(Math.min(events.length, offset + batch.length), events.length, Math.round(performance.now() - started));
  }
  return result;
}

/**
 * The run's evidence when a wizard supplied it. A caller with no evidence has
 * nowhere to report an exclusion, so a conflicting last month refuses instead.
 */
export async function loadTerminationCandidates(ctx: TrustProviderEdiContext, benefitIds: string[]): Promise<TerminationCandidate[]> {
  if (ctx.coverageEvidence?.terminationCandidates) return ctx.coverageEvidence.terminationCandidates;
  const evidence = await readTerminationEvidence(ctx, benefitIds);
  if (evidence.excluded.length) throw correctionRequired(evidence.excluded);
  const byId = new Map(evidence.coverage.map(r => [r.id, r]));
  for (const candidate of evidence.selected) assertUnambiguousMonth(evidence.coverage.filter(r => {
    const member = byId.get(candidate.memberWmbId)!;
    return r.workerId === member.workerId && r.benefitId === member.benefitId && r.year === member.year && r.month === member.month;
  }));
  const starts = await resolveSegmentStarts(ctx, evidence.selected.map(c => c.memberWmbId));
  return evidence.selected.map(({ memberWmbId, ...candidate }) =>
    ({ ...candidate, start: requireSegmentStart(starts.get(memberWmbId), memberWmbId).coverageStartYmd }));
}
