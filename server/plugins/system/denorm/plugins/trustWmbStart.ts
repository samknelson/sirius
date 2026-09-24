import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { TrustWmbEventInput } from "../../../../storage/trust/wmb-events";

/**
 * Denorm payload: the worker's "start" events — exactly one per benefit,
 * pointing at the first (earliest year/month) WMB coverage the worker has for
 * that benefit, across ALL employers.
 */
export interface TrustWmbStartDenorm {
  events: TrustWmbEventInput[];
}

const EVENT_TYPE = "start";

/**
 * `trust-wmb-start` denorm plugin — maintains the "start" slice of
 * `trust_wmb_events`. Reacts to WMB_SAVED (fired on both create and delete of
 * a `trust_wmb` row); compute rebuilds the full set from coverage so the
 * event path and backfill share one code path. The table is shared with the
 * sibling trust-wmb-restart / trust-wmb-terminate plugins, each converging
 * only its own `event_type` slice, so the write target is declared shared
 * (`soleWriter: false`) — writes are convergent replace-by-type operations
 * that are safe to re-run at any time.
 */
const trustWmbStartDenormPlugin: DenormPlugin<TrustWmbStartDenorm> = {
  metadata: {
    id: "trust-wmb-start",
    name: "Trust WMB Start Events",
    description:
      "Maintains one 'start' event per worker/benefit in trust_wmb_events, pointing at the earliest month of WMB coverage.",
    singleton: true,
    requiredComponent: "trust.benefits",
  },
  entityType: "worker",
  reads: ["workers"],
  writes: [{ storage: "trustWmbEvents", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.WMB_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<TrustWmbStartDenorm> {
    const coverage = await storage.trustWmbEvents.getWorkerBenefitCoverage(workerId);

    // Earliest (year, month) per benefit, any employer.
    const earliest = new Map<string, { year: number; month: number }>();
    for (const row of coverage) {
      const current = earliest.get(row.benefitId);
      if (!current || row.year * 12 + row.month < current.year * 12 + current.month) {
        earliest.set(row.benefitId, { year: row.year, month: row.month });
      }
    }

    const events: TrustWmbEventInput[] = Array.from(earliest.entries()).map(
      ([benefitId, { year, month }]) => ({ benefitId, year, month }),
    );
    return { events };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    // Every worker should have a denorm row for this plugin; enumerate those
    // that don't yet (read-only anti-join). Workers with no WMB coverage
    // simply converge to an empty event set.
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: TrustWmbStartDenorm): Promise<void> {
    await storage.trustWmbEvents.replaceForWorkerAndType(workerId, EVENT_TYPE, payload.events);
  },
};

registerDenormPlugin(trustWmbStartDenormPlugin);
