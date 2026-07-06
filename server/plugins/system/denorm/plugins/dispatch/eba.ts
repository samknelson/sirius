import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerDispatchEbaStorage } from "../../../../../storage/dispatch/worker-eba";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const EBA_CATEGORY = "eba";

/**
 * `dispatch_eba` denorm plugin — maintains the `eba` facts (one per date a
 * worker marked themselves available). Gated by the `dispatch.eba` component.
 */
const dispatchEbaDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_eba",
    name: "Employed but Available",
    description: "Requires workers to have marked themselves available for the job's start date",
    requiredComponent: "dispatch.eba",
    singleton: true,
  },
  entityType: "worker",
  eventHandlers: [
    {
      event: EventType.DISPATCH_EBA_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const ebaStorage = createWorkerDispatchEbaStorage();
    const ebaEntries = await ebaStorage.getByWorker(workerId);

    return {
      entries: ebaEntries.map((entry) => ({
        workerId,
        category: EBA_CATEGORY,
        value: entry.ymd,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchEbaDenormPlugin);
