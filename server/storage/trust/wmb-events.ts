import { getClient, runInTransaction } from '../transaction-context';
import {
  trustWmb,
  trustWmbScanQueue,
  trustWmbEvents,
  type TrustWmbEvent,
} from "@shared/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";

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
 * The ONLY writers of this table are the trust-wmb-* denorm plugins
 * (`server/plugins/system/denorm/plugins/trustWmb*.ts`), each converging its
 * own `event_type` slice via `replaceForWorkerAndType`. Nothing else in the
 * codebase may mutate these rows.
 *
 * The read helpers (`getWorkerBenefitCoverage`, `getWorkerScanResults`) are
 * the compute-side queries those plugins rebuild from; they live here so the
 * plugins touch a single storage namespace.
 */
export interface TrustWmbEventsStorage {
  listByWorkerAndType(workerId: string, eventType: string): Promise<TrustWmbEvent[]>;
  /**
   * Converge the worker's rows of `eventType` to exactly `events`: delete
   * rows not in the desired set, upsert the rest (data refreshed on
   * conflict). Safe to re-run at any time.
   */
  replaceForWorkerAndType(workerId: string, eventType: string, events: TrustWmbEventInput[]): Promise<void>;
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

    async replaceForWorkerAndType(workerId: string, eventType: string, events: TrustWmbEventInput[]): Promise<void> {
      await runInTransaction(async () => {
        const client = getClient();

        const sliceWhere = and(
          eq(trustWmbEvents.workerId, workerId),
          eq(trustWmbEvents.eventType, eventType),
        );

        if (events.length === 0) {
          await client.delete(trustWmbEvents).where(sliceWhere);
          return;
        }

        // Delete rows whose (benefit, year, month) key is not desired.
        const existing = await client
          .select({
            id: trustWmbEvents.id,
            benefitId: trustWmbEvents.benefitId,
            year: trustWmbEvents.year,
            month: trustWmbEvents.month,
          })
          .from(trustWmbEvents)
          .where(sliceWhere);

        const desiredKeys = new Set(events.map(e => `${e.benefitId}:${e.year}:${e.month}`));
        const staleIds = existing
          .filter(r => !desiredKeys.has(`${r.benefitId}:${r.year}:${r.month}`))
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
  };
}
