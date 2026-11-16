import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { trustWmb, trustWmbEvents, trustWmbScanQueue, workerRelations } from "@shared/schema";
import type { TrustProviderEdiContext } from "./registry";
import {
  monthIndex, monthStart, monthEnd, readTerminationPolicy, terminationWindow,
} from "./termination-policy";
import { readAsOfYmd } from "./base";

export type Coverage = Pick<typeof trustWmb.$inferSelect,
  "id" | "workerId" | "benefitId" | "year" | "month" | "sourceRelationId" | "employerId">;
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

export interface ScanEvidence {
  workerId: string; year: number; month: number;
  resultSummary: unknown;
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
 * active family. Ambiguous/dangling history is a report error, not an omission.
 */
export function selectTerminationCandidates(
  events: TermEvent[], coverage: Coverage[], relations: Relation[],
  confirmedEventIds: ReadonlySet<string>, asOf: string,
  policy: ReturnType<typeof readTerminationPolicy>,
  contradictedEventIds: ReadonlySet<string> = new Set(),
): TerminationCandidate[] {
  const window = terminationWindow(asOf, policy.months);
  const relationMap = new Map(relations.map(r => [r.id, r]));
  const byPerson = new Map<string, Coverage[]>();
  for (const row of coverage) {
    const key = `${row.workerId}|${row.benefitId}`;
    const list = byPerson.get(key) ?? [];
    list.push(row);
    byPerson.set(key, list);
  }
  const result: TerminationCandidate[] = [];
  for (const event of events) {
    const eventMonth = monthIndex(event.year, event.month);
    const endMonth = eventMonth - 1;
    if (endMonth < window.firstEnd || endMonth > window.lastEnd) continue;
    const history = byPerson.get(`${event.workerId}|${event.benefitId}`) ?? [];
    // A stale end must never override reinstatement, even after the report month.
    if (history.some(r => monthIndex(r.year, r.month) >= eventMonth)) continue;
    const previous = history.filter(r => monthIndex(r.year, r.month) === endMonth);
    if (!previous.length) throw new Error(`Termination event ${event.id}: last-covered WMB evidence is missing. Repair history before generating.`);
    const sources = new Set(previous.map(r => r.sourceRelationId));
    if (sources.size !== 1) throw new Error(`Termination event ${event.id}: ambiguous historical subscriber/dependent ownership.`);
    const member = [...previous].sort((a, b) => a.id.localeCompare(b.id))[0];
    const role = member.sourceRelationId ? "dependent" : "subscriber";
    if (role === "subscriber" ? !policy.subscribers : !policy.dependents) continue;
    const inferred = (event.data as Record<string, unknown> | null)?.provenance === "coverage_inferred";
    if (inferred && contradictedEventIds.has(event.id)) {
      throw new Error(`Termination event ${event.id}: current scan evidence contradicts retained inferred history. Reconcile coverage before generating.`);
    }
    if (!inferred && !confirmedEventIds.has(event.id)) {
      throw new Error(`Termination event ${event.id}: no current failed continuation scan supports this event. Reconcile WMB events before generating.`);
    }
    // Do not arbitrarily choose between historic COBRA/employer identities.
    if (new Set(previous.map(r => r.employerId)).size !== 1) {
      throw new Error(`Termination event ${event.id}: multiple historical employers; carrier identity is unresolved.`);
    }
    let family = member;
    if (member.sourceRelationId) {
      const relation = relationMap.get(member.sourceRelationId);
      if (!relation || relation.worker2 !== member.workerId ||
          (relation.startYmd && relation.startYmd > monthEnd(endMonth)) ||
          (relation.endYmd && relation.endYmd < monthStart(endMonth))) {
        throw new Error(`Termination event ${event.id}: historical family relation is missing or inconsistent.`);
      }
      const parents = (byPerson.get(`${relation.worker1}|${member.benefitId}`) ?? [])
        .filter(r => monthIndex(r.year, r.month) === endMonth && !r.sourceRelationId);
      if (!parents.length || new Set(parents.map(r => r.employerId)).size !== 1) {
        throw new Error(`Termination event ${event.id}: historical subscriber coverage is missing or ambiguous.`);
      }
      family = parents.sort((a, b) => a.id.localeCompare(b.id))[0];
    }
    // Episode continuity includes benefit AND historical family AND employer.
    const months = new Set(history.filter(r =>
      r.sourceRelationId === member.sourceRelationId && r.employerId === member.employerId,
    ).map(r => monthIndex(r.year, r.month)));
    let start = endMonth;
    while (months.has(start - 1)) start--;
    result.push({
      eventId: event.id, benefitId: event.benefitId, workerId: event.workerId,
      familyWmbId: family.id,
      rowKey: role === "subscriber" ? family.id : `${family.id}:${member.sourceRelationId}`,
      role, start: monthStart(start), end: monthEnd(endMonth),
      evidence: inferred ? "coverage inferred" : "confirmed scan",
    });
  }
  return result.sort((a, b) => a.eventId.localeCompare(b.eventId));
}

/** Batched population reads; only candidate workers and their historical parents. */
export async function loadTerminationCandidates(ctx: TrustProviderEdiContext, benefitIds: string[]) {
  const policy = readTerminationPolicy(ctx.configData);
  if (!policy.subscribers && !policy.dependents) return [];
  const asOf = readAsOfYmd(ctx);
  const window = terminationWindow(asOf, policy.months);
  const events = await ctx.storage.readOnly.query(db => db.select().from(trustWmbEvents).where(and(
    inArray(trustWmbEvents.benefitId, benefitIds), eq(trustWmbEvents.eventType, "terminate"),
    sql`${trustWmbEvents.year} * 12 + ${trustWmbEvents.month} - 1 BETWEEN ${window.firstEnd + 1} AND ${window.report}`,
  )));
  const result: TerminationCandidate[] = [];
  for (let offset = 0; offset < events.length; offset += 100) {
    const batch = events.slice(offset, offset + 100);
    const workerIds = [...new Set(batch.map(e => e.workerId))];
    const coverage = await ctx.storage.readOnly.query(db => db.select().from(trustWmb).where(and(
      inArray(trustWmb.workerId, workerIds), inArray(trustWmb.benefitId, benefitIds),
    )));
    const relationIds = [...new Set(coverage.map(r => r.sourceRelationId).filter((v): v is string => !!v))];
    const relations = relationIds.length ? await ctx.storage.readOnly.query(db =>
      db.select().from(workerRelations).where(inArray(workerRelations.id, relationIds))) : [];
    const parentIds = [...new Set(relations.map(r => r.worker1).filter(id => !workerIds.includes(id)))];
    if (parentIds.length) coverage.push(...await ctx.storage.readOnly.query(db =>
      db.select().from(trustWmb).where(and(inArray(trustWmb.workerId, parentIds), inArray(trustWmb.benefitId, benefitIds)))));
    // Parent scans can carry individual dependent decisions. Load once per
    // batch, not once per person. Newest attempts supersede older summaries.
    const scans = await ctx.storage.readOnly.query(db => db.select({
      workerId: trustWmbScanQueue.workerId, year: trustWmbScanQueue.year,
      month: trustWmbScanQueue.month, resultSummary: trustWmbScanQueue.resultSummary,
    }).from(trustWmbScanQueue).where(and(
      inArray(trustWmbScanQueue.status, ["success", "failed"]),
      isNotNull(trustWmbScanQueue.resultSummary),
      sql`${trustWmbScanQueue.year} * 12 + ${trustWmbScanQueue.month} - 1 BETWEEN ${window.firstEnd + 1} AND ${window.report}`,
      or(inArray(trustWmbScanQueue.workerId, workerIds),
        ...workerIds.map(id => sql`(${trustWmbScanQueue.resultSummary}->'people') @> jsonb_build_array(jsonb_build_object('workerId', ${id}::text))`)),
    )).orderBy(desc(trustWmbScanQueue.completedAt), desc(trustWmbScanQueue.id)));
    const confirmed = confirmedTerminationIds(batch, scans);
    const contradicted = new Set([...terminationScanDecisions(batch, scans)]
      .filter(([, decision]) => !decision).map(([id]) => id));
    result.push(...selectTerminationCandidates(batch, coverage, relations, confirmed, asOf, policy, contradicted));
  }
  return result;
}
