import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { employers, trustWmb, trustWmbEvents, trustWmbScanQueue, workerRelations } from "@shared/schema";
import type { CoverageSourceRecord } from "@shared/coverage-span";
import type { CoverageEndingEvidence } from "../../services/coverage-spans/derive";
import { getClient, runInTransaction } from "../transaction-context";
import { tableExists } from "../utils";

const SOURCE_LIMIT = 25_000;
function bounded<T>(rows: T[], label: string): T[] {
  if (rows.length > SOURCE_LIMIT)
    throw new Error(`Coverage span derivation exceeded ${SOURCE_LIMIT} ${label} for one worker; inspect source history before retrying.`);
  return rows;
}
const columns = {
  id: trustWmb.id, workerId: trustWmb.workerId, benefitId: trustWmb.benefitId,
  year: trustWmb.year, month: trustWmb.month, employerId: trustWmb.employerId,
  employerSiriusId: employers.siriusId, sourceRelationId: trustWmb.sourceRelationId,
};

/**
 * Derivation-only reader, never a feed fallback. Worker and source-relation
 * indexes bound coverage probes; the existing people GIN index bounds scans.
 * Each result has a hard ceiling BEFORE it is retained by the producer.
 */
export function createCoverageSpanSourceStorage() {
  return {
    async read(workerId: string) {
      return runInTransaction(async () => {
      const db = getClient();
      await db.execute(sql`SELECT set_config('statement_timeout', '10000', true)`);
      const own = bounded(await db.select(columns).from(trustWmb)
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(eq(trustWmb.workerId, workerId)).limit(SOURCE_LIMIT + 1), "coverage records");
      const relationIds = [...new Set(own.flatMap(r => r.sourceRelationId ? [r.sourceRelationId] : []))];
      const families = relationIds.length && await tableExists("worker_relations") ? bounded(await db.select({
        id: workerRelations.id, worker1: workerRelations.worker1, worker2: workerRelations.worker2,
      }).from(workerRelations).where(inArray(workerRelations.id, relationIds))
        .limit(SOURCE_LIMIT + 1), "relationships") : [];
      const coverage: CoverageSourceRecord[] = [...own];
      // Exact parent/benefit/month probes, not the parent's entire history.
      const byRelation = new Map(families.map(r => [r.id, r]));
      const coordinates = new Map<string, { workerId: string; benefitId: string; year: number; month: number }>();
      for (const row of own) {
        const parent = row.sourceRelationId && byRelation.get(row.sourceRelationId)?.worker1;
        if (parent && parent !== workerId) {
          const coordinate = { workerId: parent, benefitId: row.benefitId, year: row.year, month: row.month };
          coordinates.set(JSON.stringify(coordinate), coordinate);
        }
      }
      const needed = [...coordinates.values()];
      for (let i = 0; i < needed.length; i += 100) {
        const rows = await db.select(columns).from(trustWmb)
          .leftJoin(employers, eq(trustWmb.employerId, employers.id))
          .where(or(...needed.slice(i, i + 100).map(c => and(
            eq(trustWmb.workerId, c.workerId), eq(trustWmb.benefitId, c.benefitId),
            eq(trustWmb.year, c.year), eq(trustWmb.month, c.month),
          )))).limit(SOURCE_LIMIT + 1);
        bounded(rows, "subscriber records");
        bounded([...coverage, ...rows], "combined coverage records");
        coverage.push(...rows);
      }
      const retained = bounded(await db.select().from(trustWmbEvents)
        .where(and(eq(trustWmbEvents.workerId, workerId), eq(trustWmbEvents.eventType, "terminate")))
        .limit(SOURCE_LIMIT + 1), "termination events");
      const scans = retained.length ? bounded(await db.select({
        id: trustWmbScanQueue.id, workerId: trustWmbScanQueue.workerId,
        year: trustWmbScanQueue.year, month: trustWmbScanQueue.month,
        // Do not transport complete scan JSON (names, plugin trees, unrelated
        // family members) into each worker's rebuild. Only the decision fields
        // needed to validate retained termination evidence cross this boundary.
        resultSummary: sql<unknown>`jsonb_build_object('actions', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'workerId', a->'workerId', 'benefitId', a->'benefitId',
            'scanType', a->'scanType', 'eligible', a->'eligible',
            'action', a->'action', 'executionError', a->'executionError' IS NOT NULL
              AND a->'executionError' NOT IN ('null'::jsonb, 'false'::jsonb)))
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${trustWmbScanQueue.resultSummary}->'actions') = 'array'
            THEN ${trustWmbScanQueue.resultSummary}->'actions' ELSE '[]'::jsonb END) a
          WHERE a->>'workerId' = ${workerId}
            OR (a->>'workerId' IS NULL AND ${trustWmbScanQueue.workerId} = ${workerId})
        ), '[]'::jsonb))`,
      }).from(trustWmbScanQueue).where(and(
        inArray(trustWmbScanQueue.status, ["success", "failed"]),
        isNotNull(trustWmbScanQueue.resultSummary),
        or(eq(trustWmbScanQueue.workerId, workerId),
          sql`(${trustWmbScanQueue.resultSummary}->'people') @> jsonb_build_array(jsonb_build_object('workerId', ${workerId}::text))`),
      )).orderBy(desc(trustWmbScanQueue.completedAt), desc(trustWmbScanQueue.id))
        .limit(SOURCE_LIMIT + 1), "scan records") : [];
      // Newest attempt for each scan owner/month supersedes older attempts,
      // even if that attempt carries no action for this receiver.
      const seen = new Set<string>();
      const latest = scans.filter(scan => {
        const key = JSON.stringify([scan.workerId, scan.year, scan.month]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const events: CoverageEndingEvidence[] = retained.map(event => {
        // A person can be scanned in the same month by several owners (their
        // own scan and each subscriber's scan listing them as a dependent),
        // and one scan can carry several source actions for them. The
        // producer emits an ending when ANY newest-attempt action ends the
        // benefit and no coverage remains that month; judge evidence by the
        // same rule. Another owner's non-ending mention is not a contradiction.
        let decision: CoverageEndingEvidence["decision"] = "unsupported";
        let scanId: string | undefined;
        for (const scan of latest) {
          if (scan.year !== event.year || scan.month !== event.month) continue;
          const actions = (scan.resultSummary as { actions?: {
            workerId?: string; benefitId?: string; executionError?: unknown;
            scanType?: string; eligible?: boolean; action?: string;
          }[] } | null)?.actions;
          const matching = Array.isArray(actions) ? actions.filter(a => !a.executionError &&
            (a.workerId ? a.workerId === workerId : scan.workerId === workerId) &&
            a.benefitId === event.benefitId) : [];
          if (!matching.length) continue;
          if (matching.some(action => action.scanType === "continue" &&
            (action.eligible === false || action.action === "delete"))) {
            decision = "confirmed";
            scanId = scan.id;
            break;
          }
          if (decision === "unsupported") {
            decision = "contradicted";
            scanId = scan.id;
          }
        }
        return { ...event, decision, scanId };
      });
      return { coverage, families, events };
      });
    },
  };
}
