import { getClient, runInTransaction } from '../transaction-context';
import { trustWmb, trustWmbScanQueue, trustWmbEvents, type TrustWmbEvent } from "@shared/schema";
import { eq, and, inArray, isNotNull, sql, or, desc } from "drizzle-orm";

export const WMB_INFERRED_PROVENANCE = "coverage_inferred";
export function isInferredTermination(data: unknown): boolean {
  return !!data && typeof data === "object" &&
    (data as Record<string, unknown>).provenance === WMB_INFERRED_PROVENANCE;
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

/** A persisted scan result affecting this worker (including partial failures). */
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
          queueWorkerId: trustWmbScanQueue.workerId,
          year: trustWmbScanQueue.year,
          month: trustWmbScanQueue.month,
          resultSummary: trustWmbScanQueue.resultSummary,
        })
        .from(trustWmbScanQueue)
        .where(
          and(
            or(
              eq(trustWmbScanQueue.workerId, workerId),
              sql`(${trustWmbScanQueue.resultSummary}->'people') @> jsonb_build_array(jsonb_build_object('workerId', ${workerId}::text))`,
            ),
            inArray(trustWmbScanQueue.status, ["success", "failed"]),
            isNotNull(trustWmbScanQueue.resultSummary),
          ),
        )
        .orderBy(desc(trustWmbScanQueue.completedAt), desc(trustWmbScanQueue.id));
      const seen = new Set<string>();
      return rows.filter(row => {
        const key = `${row.queueWorkerId}:${row.year}:${row.month}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(row => ({
        ...row,
        resultSummary: {
          actions: (row.resultSummary as any)?.actions?.filter((action: any) =>
            !action.executionError && (!action.workerId || action.workerId === workerId)) ?? [],
        },
      }));
    },
  };
}
