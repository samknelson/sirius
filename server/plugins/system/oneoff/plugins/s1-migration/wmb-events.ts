import { getClient, runInTransaction } from '../../../../../storage/transaction-context';
import { trustWmbEvents } from "@shared/schema";
import { eq, and, inArray, sql, lte } from "drizzle-orm";
import { WMB_INFERRED_PROVENANCE, isInferredTermination, createTrustWmbEventsStorage } from '../../../../../storage/trust/wmb-events';

export type EventChange = "created" | "unchanged" | "removed" | "skipped";

export interface EventDecision {
  eventType: string;
  benefitId: string;
  year: number;
  month: number;
  change: EventChange;
}
export interface S1TrustWmbEventsOperations {

  /** Keyset traversal includes workers whose coverage was entirely removed. */
  pageHistoricalWorkers(after: string, limit: number, benefitId?: string, workerId?: string): Promise<string[]>;

  reconcileHistoricalWorker(workerId: string, cutoff: number, benefitId: string | undefined, dryRun: boolean): Promise<EventDecision[]>;
}

export function createS1TrustWmbEventsOperations(): S1TrustWmbEventsOperations {
  return {

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
      const { inferHistoricalEvents } = await import("./wmb-historical-inference");
      const execute = async () => {
        const client = getClient();
        const coverage = (await createTrustWmbEventsStorage().getWorkerBenefitCoverage(workerId))
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
    }
  };
}

export const s1WmbEvents = createS1TrustWmbEventsOperations();
