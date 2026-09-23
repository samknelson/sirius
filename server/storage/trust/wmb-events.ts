import { getClient, runInTransaction } from '../transaction-context';
import {
  trustWmb,
  trustWmbScanQueue,
  trustWmbEvents,
  type TrustWmbEvent,
} from "@shared/schema";
import { eq, and, inArray, isNotNull, sql, lte } from "drizzle-orm";

export const WMB_INFERRED_PROVENANCE = "coverage_inferred";
export function isInferredTermination(data: unknown): boolean {
  return !!data && typeof data === "object" &&
    (data as Record<string, unknown>).provenance === WMB_INFERRED_PROVENANCE;
}

export type EventChange = "created" | "unchanged" | "removed" | "skipped";
export interface EventDecision {
  eventType: string;
  benefitId: string;
  year: number;
  month: number;
  change: EventChange;
}

/**
 * One desired event row for `replaceForWorkerAndType`. The worker id and
 * event type come from the method arguments; the tuple below identifies the
 * row within that slice.
 */
export interface TrustWmbEventInput {
  benefitId: string;
  year: number;
  month: number;
  data?: unknown;
}

/** Distinct WMB coverage tuple for a worker (any employer counts). */
export interface WorkerBenefitCoverage {
  benefitId: string;
  year: number;
  month: number;
}

/** A persisted per-worker scan result row (successful, with a summary). */
export interface WorkerScanResultRow {
  year: number;
  month: number;
  resultSummary: any;
}

/**
 * Storage for `trust_wmb_events` — worker-month-benefit lifecycle events
 * (start / restart / terminate), owned by the trust.benefits component.
 *
 * Denorm plugins maintain scan and coverage-derived events; the historical
 * operator backfill reconciles coverage-derived starts/restarts and only
 * provenance-marked inferred terminations.
 *
 * The read helpers (`getWorkerBenefitCoverage`, `getWorkerScanResults`) are
 * the compute-side queries those plugins rebuild from; they live here so the
 * plugins touch a single storage namespace.
 */
export interface TrustWmbEventsStorage {
  listByWorkerAndType(workerId: string, eventType: string): Promise<TrustWmbEvent[]>;
  /** All rows of an event type across all workers (reconciliation reads). */
  listAllByType(eventType: string): Promise<TrustWmbEvent[]>;
  /**
   * Converge the worker's rows of `eventType` to exactly `events`: delete
    * rows not in the desired set, upsert the rest (data refreshed on
    * conflict). Inferred terminations are exempt from scan-driven deletion;
    * confirmed scans replace them at the same key. Safe to re-run.
   */
  replaceForWorkerAndType(workerId: string, eventType: string, events: TrustWmbEventInput[]): Promise<void>;
  /**
   * Distinct workers with an event of `eventType` per benefit in one month,
   * restricted to the given benefits. Benefits with no events produce no row
   * (callers should default missing entries to 0).
   */
  countWorkersByBenefitForMonth(
    benefitIds: string[],
    eventType: string,
    month: number,
    year: number,
  ): Promise<Array<{ benefitId: string; workerCount: number }>>;
  /** Distinct (benefit, year, month) coverage tuples from `trust_wmb`. */
  getWorkerBenefitCoverage(workerId: string): Promise<WorkerBenefitCoverage[]>;
  /**
   * Successful scan-queue rows for the worker that still carry a
   * `result_summary` (the terminate plugin replays these).
   */
  getWorkerScanResults(workerId: string): Promise<WorkerScanResultRow[]>;
  /** Keyset traversal includes workers whose coverage was entirely removed. */
  pageHistoricalWorkers(after: string, limit: number, benefitId?: string, workerId?: string): Promise<string[]>;
  reconcileHistoricalWorker(workerId: string, cutoff: number, benefitId: string | undefined, dryRun: boolean): Promise<EventDecision[]>;
}

export function createTrustWmbEventsStorage(): TrustWmbEventsStorage {
  return {
    async listByWorkerAndType(workerId: string, eventType: string): Promise<TrustWmbEvent[]> {
      const client = getClient();
      return client
        .select()
        .from(trustWmbEvents)
        .where(and(eq(trustWmbEvents.workerId, workerId), eq(trustWmbEvents.eventType, eventType)));
    },

    async listAllByType(eventType: string): Promise<TrustWmbEvent[]> {
      const client = getClient();
      return client
        .select()
        .from(trustWmbEvents)
        .where(eq(trustWmbEvents.eventType, eventType));
    },

    async replaceForWorkerAndType(workerId: string, eventType: string, events: TrustWmbEventInput[]): Promise<void> {
      await runInTransaction(async () => {
        const client = getClient();

        const sliceWhere = and(
          eq(trustWmbEvents.workerId, workerId),
          eq(trustWmbEvents.eventType, eventType),
        );

        // Delete rows whose (benefit, year, month) key is not desired.
        const existing = await client
          .select({
            id: trustWmbEvents.id,
            benefitId: trustWmbEvents.benefitId,
            year: trustWmbEvents.year,
            month: trustWmbEvents.month,
            data: trustWmbEvents.data,
          })
          .from(trustWmbEvents)
          .where(sliceWhere);

        const desiredKeys = new Set(events.map(e => `${e.benefitId}:${e.year}:${e.month}`));
        const staleIds = existing
          .filter(r => !desiredKeys.has(`${r.benefitId}:${r.year}:${r.month}`) &&
            !(eventType === "terminate" && isInferredTermination(r.data)))
          .map(r => r.id);
        if (staleIds.length > 0) {
          await client.delete(trustWmbEvents).where(inArray(trustWmbEvents.id, staleIds));
        }

        // Upsert the desired rows (refreshing data on conflict).
        for (const event of events) {
          await client
            .insert(trustWmbEvents)
            .values({
              workerId,
              benefitId: event.benefitId,
              year: event.year,
              month: event.month,
              eventType,
              data: event.data ?? null,
            })
            .onConflictDoUpdate({
              target: [
                trustWmbEvents.workerId,
                trustWmbEvents.year,
                trustWmbEvents.month,
                trustWmbEvents.benefitId,
                trustWmbEvents.eventType,
              ],
              set: { data: event.data ?? null },
            });
        }
      });
    },

    async countWorkersByBenefitForMonth(
      benefitIds: string[],
      eventType: string,
      month: number,
      year: number,
    ): Promise<Array<{ benefitId: string; workerCount: number }>> {
      if (benefitIds.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({
          benefitId: trustWmbEvents.benefitId,
          workerCount: sql<number>`count(distinct ${trustWmbEvents.workerId})::int`,
        })
        .from(trustWmbEvents)
        .where(
          and(
            inArray(trustWmbEvents.benefitId, benefitIds),
            eq(trustWmbEvents.eventType, eventType),
            eq(trustWmbEvents.month, month),
            eq(trustWmbEvents.year, year),
          ),
        )
        .groupBy(trustWmbEvents.benefitId);
      return rows.map((r) => ({
        benefitId: r.benefitId,
        workerCount: Number(r.workerCount) || 0,
      }));
    },

    async getWorkerBenefitCoverage(workerId: string): Promise<WorkerBenefitCoverage[]> {
      const client = getClient();
      const rows = await client
        .selectDistinct({
          benefitId: trustWmb.benefitId,
          year: trustWmb.year,
          month: trustWmb.month,
        })
        .from(trustWmb)
        .where(eq(trustWmb.workerId, workerId));
      return rows;
    },

    async getWorkerScanResults(workerId: string): Promise<WorkerScanResultRow[]> {
      const client = getClient();
      const rows = await client
        .select({
          year: trustWmbScanQueue.year,
          month: trustWmbScanQueue.month,
          resultSummary: trustWmbScanQueue.resultSummary,
        })
        .from(trustWmbScanQueue)
        .where(
          and(
            eq(trustWmbScanQueue.workerId, workerId),
            eq(trustWmbScanQueue.status, "success"),
            isNotNull(trustWmbScanQueue.resultSummary),
          ),
        );
      return rows;
    },

    async pageHistoricalWorkers(after, limit, benefitId, workerId) {
      const client = getClient();
      // UNION is bounded by the keyset predicate; orphaned lifecycle events
      // remain reachable when their source coverage has been deleted.
      const rows = await client.execute(sql`
        SELECT worker_id FROM (
          SELECT DISTINCT worker_id FROM trust_wmb
          WHERE worker_id > ${after} ${benefitId ? sql`AND benefit_id = ${benefitId}` : sql``}
          ${workerId ? sql`AND worker_id = ${workerId}` : sql``}
          UNION
          SELECT DISTINCT worker_id FROM trust_wmb_events
          WHERE worker_id > ${after}
            AND (event_type IN ('start', 'restart')
              OR (event_type = 'terminate'
                AND data->>'provenance' = ${WMB_INFERRED_PROVENANCE}))
            ${benefitId ? sql`AND benefit_id = ${benefitId}` : sql``}
            ${workerId ? sql`AND worker_id = ${workerId}` : sql``}
        ) candidates ORDER BY worker_id LIMIT ${limit}
      `);
      return (rows.rows as Array<{ worker_id: string }>).map(r => r.worker_id);
    },

    async reconcileHistoricalWorker(workerId, cutoff, benefitId, dryRun) {
      const { inferHistoricalEvents } = await import("../../services/wmb-historical-inference");
      const execute = async () => {
        const client = getClient();
        const coverage = (await this.getWorkerBenefitCoverage(workerId))
          .filter(r => !benefitId || r.benefitId === benefitId);
        const desired = inferHistoricalEvents(coverage, cutoff);
        const existing = await client.select().from(trustWmbEvents).where(and(
          eq(trustWmbEvents.workerId, workerId),
          inArray(trustWmbEvents.eventType, ["start", "restart", "terminate"]),
          benefitId ? eq(trustWmbEvents.benefitId, benefitId) : undefined,
          lte(sql<number>`${trustWmbEvents.year} * 12 + ${trustWmbEvents.month}`, cutoff),
        ));
        const key = (e: { eventType: string; benefitId: string; year: number; month: number }) =>
          `${e.eventType}:${e.benefitId}:${e.year}:${e.month}`;
        const desiredKeys = new Set(desired.map(key));
        const existingMap = new Map(existing.map(e => [key(e), e]));
        const decisions: EventDecision[] = [];
        for (const event of desired) {
          const old = existingMap.get(key(event));
          const change: EventChange = old
            ? event.eventType === "terminate" && !isInferredTermination(old.data) ? "skipped" : "unchanged"
            : "created";
          decisions.push({ ...event, change });
          if (change === "created" && !dryRun) {
            const inserted = await client.insert(trustWmbEvents).values({
              workerId, benefitId: event.benefitId, year: event.year, month: event.month,
              eventType: event.eventType,
              data: event.eventType === "terminate"
                ? { provenance: WMB_INFERRED_PROVENANCE, failedPlugins: [] } : null,
            }).onConflictDoNothing().returning({ id: trustWmbEvents.id });
            if (!inserted.length) decisions[decisions.length - 1].change = "skipped";
          }
        }
        for (const old of existing) {
          if (desiredKeys.has(key(old))) continue;
          // Never delete a scan-confirmed termination or a site-specific type.
          if (old.eventType === "terminate" && !isInferredTermination(old.data)) continue;
          decisions.push({ eventType: old.eventType, benefitId: old.benefitId, year: old.year, month: old.month, change: "removed" });
          if (!dryRun) {
            const deleted = await client.delete(trustWmbEvents).where(and(
              eq(trustWmbEvents.id, old.id),
              old.eventType === "terminate"
                ? sql`${trustWmbEvents.data}->>'provenance' = ${WMB_INFERRED_PROVENANCE}`
                : eq(trustWmbEvents.eventType, old.eventType),
            )).returning({ id: trustWmbEvents.id });
            if (!deleted.length) decisions[decisions.length - 1].change = "skipped";
          }
        }
        return decisions;
      };
      return dryRun ? execute() : runInTransaction(execute);
    },
  };
}
