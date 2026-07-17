import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerDispatchStatusStorage } from "../../../../../storage/dispatch/worker-status";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const DISPSTATUS_CATEGORY = "dispstatus";
const AVAILABLE_VALUE = "Available";

/**
 * `dispatch_status` denorm plugin — maintains the `dispstatus` fact (present and
 * equal to "Available" only when the worker's dispatch status is available).
 * Gated by the `dispatch` component.
 */
const dispatchStatusDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_status",
    name: "Dispatch Availability",
    description: "Only includes workers whose dispatch status is set to Available",
    requiredComponent: "dispatch",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerDispatchStatus"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.DISPATCH_STATUS_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const statusStorage = createWorkerDispatchStatusStorage();
    const workerStatus = await statusStorage.getByWorker(workerId);

    if (!workerStatus || workerStatus.status !== "available") {
      return { entries: [] };
    }

    return {
      entries: [{ workerId, category: DISPSTATUS_CATEGORY, value: AVAILABLE_VALUE }],
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchStatusDenormPlugin);
