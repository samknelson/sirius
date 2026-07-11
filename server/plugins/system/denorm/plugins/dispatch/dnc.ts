import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerDispatchDncStorage } from "../../../../../storage/dispatch/worker-dnc";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const DNC_CATEGORY = "dnc";

/**
 * `dispatch_dnc` denorm plugin — maintains the `dnc` facts (one per Do-Not-Call
 * employer for the worker). Gated by the `dispatch.dnc` component.
 */
const dispatchDncDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_dnc",
    name: "Do Not Call",
    description: "Excludes workers who have a Do Not Call entry for the job's employer",
    requiredComponent: "dispatch.dnc",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "workerDispatchDnc"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.DISPATCH_DNC_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const dncStorage = createWorkerDispatchDncStorage();
    const dncEntries = await dncStorage.getByWorker(workerId);

    return {
      entries: dncEntries.map((dnc) => ({
        workerId: dnc.workerId,
        category: DNC_CATEGORY,
        value: dnc.employerId,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchDncDenormPlugin);
