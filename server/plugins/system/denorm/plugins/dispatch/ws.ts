import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { storage } from "../../../../../storage";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const WS_CATEGORY = "ws";

/**
 * `dispatch_ws` denorm plugin — maintains the `ws` fact (the worker's current
 * work-status id). The eligibility query filters by the configured eligible
 * work statuses; this plugin only records the worker's own status. Gated by the
 * `dispatch` component.
 */
const dispatchWsDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_ws",
    name: "Work Status",
    description: "Filters workers based on eligible work statuses configured per job type",
    requiredComponent: "dispatch",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.WORKER_WS_CHANGED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const worker = await storage.workers.getWorker(workerId);

    if (!worker || !worker.denormWsId) {
      return { entries: [] };
    }

    return {
      entries: [{ workerId, category: WS_CATEGORY, value: worker.denormWsId }],
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchWsDenormPlugin);
