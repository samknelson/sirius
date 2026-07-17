import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { TrustWmbEventInput } from "../../../../storage/trust/wmb-events";

/**
 * Denorm payload: the worker's "restart" events — one per coverage-run start
 * month for each benefit (a covered month whose previous month is NOT
 * covered), across ALL employers. E.g. coverage Jan–Feb, Apr–May, Oct–Dec
 * yields restart events in January, April and October.
 */
export interface TrustWmbRestartDenorm {
  events: TrustWmbEventInput[];
}

const EVENT_TYPE = "restart";

/**
 * `trust-wmb-restart` denorm plugin — maintains the "restart" slice of
 * `trust_wmb_events`. Reacts to WMB_SAVED (create and delete); compute
 * rebuilds the full restart set from coverage, so a single save/delete can
 * add, move, or remove several restart rows in one convergent replace. The
 * table is shared with the sibling trust-wmb-start / trust-wmb-terminate
 * plugins (each owns its own `event_type` slice), hence `soleWriter: false`.
 */
const trustWmbRestartDenormPlugin: DenormPlugin<TrustWmbRestartDenorm> = {
  metadata: {
    id: "trust-wmb-restart",
    name: "Trust WMB Restart Events",
    description:
      "Maintains 'restart' events in trust_wmb_events — one per coverage-run start month for each worker/benefit.",
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

  async compute(workerId: string): Promise<TrustWmbRestartDenorm> {
    const coverage = await storage.trustWmbEvents.getWorkerBenefitCoverage(workerId);

    // Distinct covered period keys per benefit (any employer counts).
    const byBenefit = new Map<string, Set<number>>();
    for (const row of coverage) {
      const key = row.year * 12 + row.month;
      let set = byBenefit.get(row.benefitId);
      if (!set) {
        set = new Set<number>();
        byBenefit.set(row.benefitId, set);
      }
      set.add(key);
    }

    // A restart is any covered month whose previous month is not covered —
    // i.e. the first month of each contiguous coverage run (including the
    // very first run).
    const events: TrustWmbEventInput[] = [];
    for (const [benefitId, periods] of Array.from(byBenefit.entries())) {
      for (const key of Array.from(periods)) {
        if (!periods.has(key - 1)) {
          const month = key % 12 === 0 ? 12 : key % 12;
          const year = (key - month) / 12;
          events.push({ benefitId, year, month });
        }
      }
    }
    return { events };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: TrustWmbRestartDenorm): Promise<void> {
    await storage.trustWmbEvents.replaceForWorkerAndType(workerId, EVENT_TYPE, payload.events);
  },
};

registerDenormPlugin(trustWmbRestartDenormPlugin);
