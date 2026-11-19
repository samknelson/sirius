import { sql } from "drizzle-orm";
import { employers, trustWmb, trustWmbEvents } from "@shared/schema";
import type { TrustProviderEdiContext } from "./registry";
import { COBRA_EMPLOYER_SIRIUS_IDS } from "./coverage-segments";
import { COVERAGE_LIMITS } from "./coverage-budget";
import { monthStart } from "./termination-policy";

/**
 * Segment start from lifecycle events.
 *
 * An anchor is one coverage record: it names the person, the benefit, the
 * anchor month and the class (subscriber or dependent source, COBRA or not).
 * Report-month members anchor on the reporting month; termination candidates
 * anchor on their last covered month.
 *
 * The start is the latest `restart` event month at or before the anchor month,
 * moved forward to the month after the latest month in that range where the
 * person holds no coverage record of the anchor's class. The database works
 * that out and returns ONE small row per anchor: nothing older than the run
 * start is read, and a person's months never reach the application.
 */
export interface SegmentStart {
  /** The anchor coverage record id. */
  id: string;
  workerId: string;
  benefitId: string;
  isCobra: boolean;
  /** yyyy-mm-01, or null when it could not be established (see `problem`). */
  coverageStartYmd: string | null;
  /**
   * "missing-event": no `restart` event at or before the anchor month.
   * "inconsistent-event": the run the event describes has a month without
   * coverage, so the event is behind the coverage records.
   */
  problem: "missing-event" | "inconsistent-event" | null;
  /**
   * Conflicting months inside the segment, before the anchor month, as COUNTS:
   * months, and the coverage records they hold. A record of the anchor's own
   * class exists in each, so they do not move the start. The records are read
   * separately (`readSegmentConflicts`) once the counts fit the run's budget.
   */
  conflictMonths: number;
  conflictRecords: number;
  /** Covered months the database aggregated for this anchor. */
  monthsRead: number;
  /** Months aggregated from before the run start. Measured, and always 0. */
  monthsBeforeRunStart: number;
}

type Db = Parameters<Parameters<TrustProviderEdiContext["storage"]["readOnly"]["query"]>[0]>[0];

interface StartRow {
  id: string; worker_id: string; benefit_id: string; cobra: boolean;
  anchor_idx: number; restart_idx: number | null; last_break: number | null;
  covered: number | null; first_idx: number | null;
  conflict_months: number | null; conflict_records: number | null;
}

/** One statement for up to `COVERAGE_LIMITS.page` anchors. */
export async function readSegmentStarts(db: Db, anchorIds: readonly string[]): Promise<SegmentStart[]> {
  if (!anchorIds.length) return [];
  const ids = sql.join(anchorIds.map(id => sql`${id}`), sql`, `);
  const cobraIds = sql.join(COBRA_EMPLOYER_SIRIUS_IDS.map(id => sql`${id}`), sql`, `);
  const result: unknown = await db.execute(sql`
    WITH anchor AS (
      SELECT w.id, w.worker_id, w.benefit_id, w.source_relation_id,
             coalesce(e.sirius_id, '') IN (${cobraIds}) AS cobra,
             w.year * 12 + w.month - 1 AS anchor_idx
      FROM ${trustWmb} w LEFT JOIN ${employers} e ON e.id = w.employer_id
      WHERE w.id IN (${ids})
    ), run AS (
      SELECT a.*, (
        SELECT max(ev.year * 12 + ev.month - 1) FROM ${trustWmbEvents} ev
        WHERE ev.worker_id = a.worker_id AND ev.benefit_id = a.benefit_id AND ev.event_type = 'restart'
          AND ev.year * 12 + ev.month - 1 <= a.anchor_idx
      ) AS restart_idx
      FROM anchor a
    ), months AS (
      SELECT r.id, r.anchor_idx, w.year * 12 + w.month - 1 AS idx,
             bool_or(w.source_relation_id IS NOT DISTINCT FROM r.source_relation_id
               AND (coalesce(e.sirius_id, '') IN (${cobraIds})) = r.cobra) AS same_class,
             count(DISTINCT coalesce(w.source_relation_id, '') || '|' ||
               (coalesce(e.sirius_id, '') IN (${cobraIds}))::text) AS classes,
             count(*) AS records
      FROM run r
      JOIN ${trustWmb} w ON w.worker_id = r.worker_id AND w.benefit_id = r.benefit_id
        -- The year bounds keep the worker/year/month index range at the run.
        AND w.year BETWEEN r.restart_idx / 12 AND r.anchor_idx / 12
        AND w.year * 12 + w.month - 1 BETWEEN r.restart_idx AND r.anchor_idx
      LEFT JOIN ${employers} e ON e.id = w.employer_id
      GROUP BY r.id, r.anchor_idx, w.year * 12 + w.month - 1
    ), marked AS (
      SELECT m.*, max(m.idx) FILTER (WHERE NOT m.same_class) OVER (PARTITION BY m.id) AS last_break
      FROM months m
    ), summary AS (
      -- Counts only: however many months conflict, the answer stays one small
      -- row per anchor, so the caller can refuse before reading any of them.
      SELECT m.id, max(m.last_break) AS last_break, count(*)::int AS covered, min(m.idx) AS first_idx,
             (count(*) FILTER (WHERE m.classes > 1 AND m.idx > coalesce(m.last_break, -1)
               AND m.idx < m.anchor_idx))::int AS conflict_months,
             (coalesce(sum(m.records) FILTER (WHERE m.classes > 1 AND m.idx > coalesce(m.last_break, -1)
               AND m.idx < m.anchor_idx), 0))::int AS conflict_records
      FROM marked m GROUP BY m.id
    )
    SELECT r.id, r.worker_id, r.benefit_id, r.cobra, r.anchor_idx, r.restart_idx,
           s.last_break, s.covered, s.first_idx, s.conflict_months, s.conflict_records
    FROM run r LEFT JOIN summary s ON s.id = r.id`);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as StartRow[];
  return rows.map(segmentStartFromRow);
}

function segmentStartFromRow(row: StartRow): SegmentStart {
  const anchor = Number(row.anchor_idx);
  const base = { id: row.id, workerId: row.worker_id, benefitId: row.benefit_id, isCobra: row.cobra === true,
    monthsRead: Number(row.covered ?? 0),
    monthsBeforeRunStart: row.restart_idx != null && row.first_idx != null
      ? Math.max(0, Number(row.restart_idx) - Number(row.first_idx)) : 0 };
  if (row.restart_idx == null)
    return { ...base, coverageStartYmd: null, problem: "missing-event", conflictMonths: 0, conflictRecords: 0 };
  const restart = Number(row.restart_idx);
  // A restart month opens a run of consecutive covered months. A hole between
  // it and the anchor means the event has not caught up with coverage.
  if (Number(row.covered ?? 0) !== anchor - restart + 1 || Number(row.first_idx) !== restart)
    return { ...base, coverageStartYmd: null, problem: "inconsistent-event", conflictMonths: 0, conflictRecords: 0 };
  const start = row.last_break == null ? restart : Number(row.last_break) + 1;
  return {
    ...base, problem: null, coverageStartYmd: monthStart(start),
    conflictMonths: Number(row.conflict_months ?? 0), conflictRecords: Number(row.conflict_records ?? 0),
  };
}

export interface SegmentConflictRecord {
  id: string; workerId: string; benefitId: string; year: number; month: number;
  employerId: string; sourceRelationId: string | null; employerSiriusId: string | null;
}

/**
 * The coverage records of the conflicting months inside each anchor's segment,
 * before the anchor month. Only those months come back, never the rest of the
 * run. Call it for anchors whose counts were already charged to the budget.
 */
export async function readSegmentConflicts(
  db: Db, segments: readonly { id: string; coverageStartYmd: string }[],
): Promise<SegmentConflictRecord[]> {
  if (!segments.length) return [];
  const cobraIds = sql.join(COBRA_EMPLOYER_SIRIUS_IDS.map(id => sql`${id}`), sql`, `);
  const values = sql.join(segments.map(s => {
    const [year, month] = s.coverageStartYmd.split("-").map(Number);
    return sql`(${s.id}, ${year * 12 + month - 1}::int)`;
  }), sql`, `);
  const result: unknown = await db.execute(sql`
    SELECT t.id, t.worker_id, t.benefit_id, t.year, t.month, t.employer_id, t.source_relation_id, t.employer_sirius_id
    FROM (
      SELECT w.id, w.worker_id, w.benefit_id, w.year, w.month, w.employer_id, w.source_relation_id,
             e.sirius_id AS employer_sirius_id,
             min(coalesce(w.source_relation_id, '') || '|' || (coalesce(e.sirius_id, '') IN (${cobraIds}))::text) OVER month_records
               <> max(coalesce(w.source_relation_id, '') || '|' || (coalesce(e.sirius_id, '') IN (${cobraIds}))::text) OVER month_records AS conflicting
      FROM (VALUES ${values}) AS s(id, start_idx)
      JOIN ${trustWmb} a ON a.id = s.id
      JOIN ${trustWmb} w ON w.worker_id = a.worker_id AND w.benefit_id = a.benefit_id
        AND w.year BETWEEN s.start_idx / 12 AND a.year
        AND w.year * 12 + w.month - 1 >= s.start_idx
        AND w.year * 12 + w.month < a.year * 12 + a.month
      LEFT JOIN ${employers} e ON e.id = w.employer_id
      WINDOW month_records AS (PARTITION BY s.id, w.year, w.month)
    ) t WHERE t.conflicting`);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<string, unknown>[];
  return rows.map(r => ({
    id: String(r.id), workerId: String(r.worker_id), benefitId: String(r.benefit_id),
    year: Number(r.year), month: Number(r.month), employerId: String(r.employer_id),
    sourceRelationId: (r.source_relation_id as string | null) ?? null,
    employerSiriusId: (r.employer_sirius_id as string | null) ?? null,
  }));
}

/**
 * Batched for any number of anchors; every statement stays inside the
 * per-query limit. `onBatch` lets the caller report progress and log resources.
 */
export async function resolveSegmentStarts(
  ctx: TrustProviderEdiContext, anchorIds: readonly string[],
  onBatch?: (done: number, total: number, milliseconds: number, batch: readonly SegmentStart[]) => Promise<void> | void,
): Promise<Map<string, SegmentStart>> {
  const unique = [...new Set(anchorIds)];
  const starts = new Map<string, SegmentStart>();
  for (let offset = 0; offset < unique.length; offset += COVERAGE_LIMITS.page) {
    const started = performance.now();
    const batch = unique.slice(offset, offset + COVERAGE_LIMITS.page);
    const read = await ctx.storage.readOnly.query(db => readSegmentStarts(db, batch),
      { statementTimeoutMs: COVERAGE_LIMITS.queryMs });
    for (const start of read) starts.set(start.id, start);
    await onBatch?.(Math.min(unique.length, offset + batch.length), unique.length, Math.round(performance.now() - started), read);
  }
  return starts;
}

/** Callers outside an evidence check (single batches) refuse rather than guess. */
export function requireSegmentStart(start: SegmentStart | undefined, id: string): { isCobra: boolean; coverageStartYmd: string } {
  if (!start) throw new Error(`WMB ${id}: coverage changed or is missing. Regenerate after correcting coverage.`);
  if (!start.coverageStartYmd) throw new Error(start.problem === "missing-event"
    ? `WMB ${id}: no coverage lifecycle event establishes this person's coverage start. Wait for lifecycle event maintenance to finish, then retry.`
    : `WMB ${id}: the coverage lifecycle event for this person is behind their coverage records. Wait for lifecycle event maintenance to finish, then retry.`);
  return { isCobra: start.isCobra, coverageStartYmd: start.coverageStartYmd };
}
