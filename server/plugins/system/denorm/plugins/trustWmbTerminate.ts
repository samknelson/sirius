import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";
import { EventType } from "../../../../services/event-bus";
import { storage } from "../../../../storage";
import type { TrustWmbEventInput } from "../../../../storage/trust/wmb-events";

/**
 * Denorm payload: the worker's "terminate" events — one per
 * [benefit, year, month] where a WMB scan decided the benefit should stop
 * (a `continue` scan with a `delete` action), EXCLUDING months where the
 * worker currently has coverage for that benefit (a benefit cannot terminate
 * in a month it is covered). The event's `data` carries the eligibility
 * plugins that failed in that scan.
 */
export interface TrustWmbTerminateDenorm {
  events: TrustWmbEventInput[];
}

const EVENT_TYPE = "terminate";

interface ScanSummaryAction {
  benefitId?: string;
  scanType?: string;
  action?: string;
  pluginResults?: Array<{
    pluginKey?: string;
    eligible?: boolean;
    reason?: string;
  }>;
}

/**
 * `trust-wmb-terminate` denorm plugin — maintains the "terminate" slice of
 * `trust_wmb_events`.
 *
 * Reacts to the per-worker scan-result event (TRUST_WMB_SCAN_WORKER_COMPLETED,
 * emitted when a scan queue job result is recorded) and to WMB_SAVED (so a
 * coverage row saved for a month with an existing terminate event clears that
 * event). Compute rebuilds the full terminate set from the PERSISTED scan
 * queue result summaries (`trust_wmb_scan_queue.result_summary`), which is
 * also exactly what backfill replays — event path and backfill share one code
 * path. The table is shared with the sibling trust-wmb-start /
 * trust-wmb-restart plugins (each owns its own `event_type` slice), hence
 * `soleWriter: false`.
 */
const trustWmbTerminateDenormPlugin: DenormPlugin<TrustWmbTerminateDenorm> = {
  metadata: {
    id: "trust-wmb-terminate",
    name: "Trust WMB Terminate Events",
    description:
      "Maintains 'terminate' events in trust_wmb_events from WMB scan results, with the failed eligibility plugins in the event data.",
    singleton: true,
    requiredComponent: "trust.benefits",
  },
  entityType: "worker",
  reads: ["workers"],
  writes: [{ storage: "trustWmbEvents", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.TRUST_WMB_SCAN_WORKER_COMPLETED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
    {
      // Coverage saved/deleted for a month can add or clear terminate events
      // (a benefit cannot terminate in a month it has coverage).
      event: EventType.WMB_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<TrustWmbTerminateDenorm> {
    const [scanRows, coverage] = await Promise.all([
      storage.trustWmbEvents.getWorkerScanResults(workerId),
      storage.trustWmbEvents.getWorkerBenefitCoverage(workerId),
    ]);

    const coveredKeys = new Set(
      coverage.map(c => `${c.benefitId}:${c.year}:${c.month}`),
    );

    // One terminate candidate per (benefit, year, month); the scan queue is
    // unique per worker/month so at most one summary exists per month.
    const byKey = new Map<string, TrustWmbEventInput>();
    for (const row of scanRows) {
      const actions: ScanSummaryAction[] = Array.isArray(row.resultSummary?.actions)
        ? row.resultSummary.actions
        : [];
      for (const action of actions) {
        if (!action.benefitId) continue;
        if (action.scanType !== "continue" || action.action !== "delete") continue;

        const key = `${action.benefitId}:${row.year}:${row.month}`;
        // A month with current coverage for the benefit cannot terminate.
        if (coveredKeys.has(key)) continue;

        const failedPlugins = (action.pluginResults ?? [])
          .filter(r => r && r.eligible === false)
          .map(r => ({ pluginKey: r.pluginKey, reason: r.reason }));

        byKey.set(key, {
          benefitId: action.benefitId,
          year: row.year,
          month: row.month,
          data: { failedPlugins },
        });
      }
    }

    return { events: Array.from(byKey.values()) };
  },

  async backfill(configId: string, limit: number): Promise<string[]> {
    // Replays persisted scan-queue result summaries: compute reads them all
    // back, so enumerating workers without a denorm row is sufficient.
    return storage.workers.findIdsMissingDenorm(configId, limit);
  },

  async findWidows(configId: string, limit: number): Promise<string[]> {
    return storage.workers.findDenormWidowIds(configId, limit);
  },

  async write(workerId: string, payload: TrustWmbTerminateDenorm): Promise<void> {
    await storage.trustWmbEvents.replaceForWorkerAndType(workerId, EVENT_TYPE, payload.events);
  },
};

registerDenormPlugin(trustWmbTerminateDenormPlugin);
