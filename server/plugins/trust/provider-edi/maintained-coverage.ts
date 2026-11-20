import { and, eq, gt, inArray, lte, gte, or, sql } from "drizzle-orm";
import { denorm, denormSpan, denormIssue, trustWmb, employers, workerRelations } from "@shared/schema";
import { COVERAGE_SPAN_PLUGIN, type CoverageSpanFact, type CoverageIssueFact } from "@shared/coverage-span";
import type { TrustProviderEdiContext } from "./registry";
import type { SegmentStart, SegmentConflictRecord } from "./coverage-starts";
import { CoverageBudget, COVERAGE_LIMITS, readBudgetedPages } from "./coverage-budget";
import { monthIndex, monthStart, readTerminationPolicy, terminationWindow } from "./termination-policy";
import { readAsOfYmd } from "./base";
import { selectTerminationCandidates, type TerminationEvidence } from "./termination-population";
import type { EvidenceRow } from "./coverage-conflicts";

type Db = Parameters<Parameters<TrustProviderEdiContext["storage"]["readOnly"]["query"]>[0]>[0];
const columns = {
  id: trustWmb.id, workerId: trustWmb.workerId, benefitId: trustWmb.benefitId,
  year: trustWmb.year, month: trustWmb.month, employerId: trustWmb.employerId,
  sourceRelationId: trustWmb.sourceRelationId, employerSiriusId: employers.siriusId,
};

export async function maintainedStarts(db: Db, ids: readonly string[]): Promise<SegmentStart[]> {
  if (!ids.length) return [];
  const result = await db.execute(sql`
    SELECT w.id, w.worker_id, w.benefit_id, s.data,
      (SELECT count(*)::int FROM denorm_issue i WHERE i.denorm_id = d.id
        AND i.subject_id = w.benefit_id AND i.reason = 'conflicting-coverage'
        AND i.month >= (s.data->>'continuityStartMonth')::date
        AND i.month < make_date(w.year, w.month, 1)) AS conflict_months,
      (SELECT coalesce(sum(jsonb_array_length(i.data->'records')), 0)::int FROM denorm_issue i
        WHERE i.denorm_id = d.id AND i.subject_id = w.benefit_id AND i.reason = 'conflicting-coverage'
        AND i.month >= (s.data->>'continuityStartMonth')::date
        AND i.month < make_date(w.year, w.month, 1)) AS conflict_records
    FROM trust_wmb w
    JOIN denorm d ON d.entity_id = w.worker_id AND d.entity_type = 'worker' AND d.status = 'ok'
    JOIN plugin_configs c ON c.id = d.config_id AND c.plugin_kind = 'denorm'
      AND c.plugin_id = ${COVERAGE_SPAN_PLUGIN} AND c.enabled
    JOIN denorm_span s ON s.denorm_id = d.id AND s.subject_id = w.benefit_id
      AND make_date(w.year, w.month, 1) BETWEEN s.start_month AND s.last_month
      AND s.data->>'sourceRelationId' IS NOT DISTINCT FROM w.source_relation_id
    WHERE w.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      AND (s.data->>'usable')::boolean`);
  return (result.rows as { id: string; worker_id: string; benefit_id: string; data: CoverageSpanFact; conflict_months: number; conflict_records: number }[]).map(row => ({
    id: row.id, workerId: row.worker_id, benefitId: row.benefit_id, isCobra: row.data.isCobra,
    coverageStartYmd: row.data.continuityStartMonth,
    problem: row.data.continuityStartMonth ? null : "missing-event",
    conflictMonths: Number(row.conflict_months), conflictRecords: Number(row.conflict_records), monthsRead: 0, monthsBeforeRunStart: 0,
  }));
}

export async function maintainedConflicts(
  db: Db, segments: readonly { id: string; coverageStartYmd: string }[],
): Promise<SegmentConflictRecord[]> {
  if (!segments.length) return [];
  const values = sql.join(segments.map(s => sql`(${s.id}, ${s.coverageStartYmd}::date)`), sql`, `);
  const result = await db.execute(sql`
    SELECT DISTINCT i.data FROM (VALUES ${values}) a(id, start_month)
    JOIN trust_wmb w ON w.id = a.id
    JOIN denorm d ON d.entity_id = w.worker_id AND d.status = 'ok'
    JOIN plugin_configs c ON c.id = d.config_id AND c.plugin_id = ${COVERAGE_SPAN_PLUGIN}
      AND c.plugin_kind = 'denorm' AND c.enabled
    JOIN denorm_issue i ON i.denorm_id = d.id AND i.subject_id = w.benefit_id
      AND i.month >= a.start_month AND i.month < make_date(w.year, w.month, 1)
    WHERE i.reason = 'conflicting-coverage'`);
  return (result.rows as { data: CoverageIssueFact }[]).flatMap(row => row.data.records);
}

/**
 * Read persisted endings and issues, then hydrate ONLY the last covered month
 * used in the file. Never scan lifecycle history or continuation JSON here.
 */
export async function maintainedTerminations(
  ctx: TrustProviderEdiContext, benefitIds: string[],
  budget = new CoverageBudget(ctx.coverageCorrelation),
): Promise<TerminationEvidence> {
  const policy = ctx.terminationPolicy ?? readTerminationPolicy(ctx.configData);
  const result: TerminationEvidence = { selected: [], excluded: [], events: [], coverage: [], relations: [] };
  if ((!policy.subscribers && !policy.dependents) || !benefitIds.length) return result;
  const asOf = readAsOfYmd(ctx);
  const window = terminationWindow(asOf, policy.months);
  const [config] = await ctx.storage.pluginConfigs.getByKindAndPlugin("denorm", COVERAGE_SPAN_PLUGIN);
  if (!config?.enabled) throw new Error("Coverage span maintenance is not enabled. No termination dates were estimated.");
  const limit = { statementTimeoutMs: COVERAGE_LIMITS.queryMs };
  const first = monthStart(window.firstEnd + 1), last = monthStart(window.report);
  const problems = await ctx.storage.readOnly.query(db => db.select({ data: denormIssue.data })
    .from(denormIssue).innerJoin(denorm, eq(denormIssue.denormId, denorm.id))
    .where(and(eq(denorm.configId, config.id), inArray(denormIssue.subjectId, benefitIds),
      sql`EXISTS (SELECT 1 FROM workers alive WHERE alive.id = ${denorm.entityId})`,
      gte(denormIssue.month, first), lte(denormIssue.month, last),
      // A disabled role must not veto this feed. Empty/malformed record
      // evidence cannot establish a role, so it deliberately fails closed.
      sql`(CASE WHEN jsonb_typeof(${denormIssue.data}->'records') = 'array'
        THEN jsonb_array_length(${denormIssue.data}->'records') = 0 OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(${denormIssue.data}->'records') record
          WHERE jsonb_typeof(record) <> 'object'
             OR NOT (record ? 'sourceRelationId')
             OR jsonb_typeof(record->'sourceRelationId') NOT IN ('null', 'string')
             OR (${policy.subscribers} AND record->>'sourceRelationId' IS NULL)
             OR (${policy.dependents} AND record->>'sourceRelationId' IS NOT NULL)
        ) ELSE true END)`,
      inArray(denormIssue.reason, ["unsupported-termination", "contradicted-inference", "termination-coverage-missing"])))
    .limit(21), limit);
  if (problems.length) throw new Error(`Coverage ending evidence needs correction: ${problems.map(row => {
    const issue = row.data as CoverageIssueFact;
    return `${issue.reason} for worker ${issue.workerId}, benefit ${issue.benefitId}, month ${issue.month}, event ${issue.eventId}`;
  }).join("; ")}. No termination dates were estimated.`);
  const spans = await readBudgetedPages(budget, (after, pageSize) => ctx.storage.readOnly.query(db =>
    db.select({ id: denormSpan.id, data: denormSpan.data }).from(denormSpan)
      .innerJoin(denorm, eq(denormSpan.denormId, denorm.id))
      .where(and(eq(denorm.configId, config.id), eq(denorm.status, "ok"),
        sql`EXISTS (SELECT 1 FROM workers alive WHERE alive.id = ${denorm.entityId})`,
        inArray(denormSpan.subjectId, benefitIds),
        gte(denormSpan.terminationMonth, first), lte(denormSpan.terminationMonth, last),
        after ? gt(denormSpan.id, after) : undefined))
      .orderBy(denormSpan.id).limit(pageSize), limit));
  const facts = spans.map(row => row.data as CoverageSpanFact);
  const knownEvents = new Set<string>();
  const confirmed = new Set<string>();
  const coordinates = new Map<string, { workerId: string; benefitId: string; year: number; month: number }>();
  for (const fact of facts) {
    const ending = fact.ending!;
    const [year, month] = ending.month.split("-").map(Number);
    if (!knownEvents.has(ending.eventId)) {
      knownEvents.add(ending.eventId);
      result.events.push({ id: ending.eventId, workerId: fact.workerId, benefitId: fact.benefitId,
        year, month, data: ending.eventData });
    }
    if (ending.reason === "confirmed-continuation-failure") confirmed.add(ending.eventId);
    const [coveredYear, coveredMonth] = fact.lastCoveredMonth.split("-").map(Number);
    for (const workerId of new Set([fact.workerId, fact.subscriberWorkerId].filter((id): id is string => !!id))) {
      const c = { workerId, benefitId: fact.benefitId, year: coveredYear, month: coveredMonth };
      coordinates.set(JSON.stringify(c), c);
    }
  }
  const coords = [...coordinates.values()];
  for (let i = 0; i < coords.length; i += 100) {
    const batch = coords.slice(i, i + 100);
    const rows = await readBudgetedPages(budget, (after, pageSize) => ctx.storage.readOnly.query(db =>
      db.select(columns).from(trustWmb).leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(and(or(...batch.map(c => and(eq(trustWmb.workerId, c.workerId),
          eq(trustWmb.benefitId, c.benefitId), eq(trustWmb.year, c.year), eq(trustWmb.month, c.month)))),
        after ? gt(trustWmb.id, after) : undefined)).orderBy(trustWmb.id).limit(pageSize), limit));
    result.coverage.push(...rows as EvidenceRow[]);
  }
  const relationIds = [...new Set(result.coverage.flatMap(r => r.sourceRelationId ? [r.sourceRelationId] : []))];
  for (let i = 0; i < relationIds.length; i += COVERAGE_LIMITS.page) {
    result.relations.push(...await ctx.storage.readOnly.query(db => db.select().from(workerRelations)
      .where(inArray(workerRelations.id, relationIds.slice(i, i + COVERAGE_LIMITS.page))), limit));
  }
  const selected = selectTerminationCandidates(result.events, result.coverage, result.relations,
    confirmed, asOf, policy);
  result.selected = selected.selected;
  result.excluded = selected.excluded;
  return result;
}
