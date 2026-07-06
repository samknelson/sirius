import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createWorkerDispatchHfeStorage } from "../../../../../storage/dispatch/worker-hfe";
import {
  type DispatchEligDenormPayload,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const HFE_CATEGORY = "hfe";

/**
 * `dispatch_hfe` denorm plugin — maintains the `hfe` facts (one per employer a
 * worker is held for). Gated by the `dispatch.hfe` component.
 */
const dispatchHfeDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_hfe",
    name: "Employer Priority",
    description: "Only includes workers who are being held for a specific employer",
    requiredComponent: "dispatch.hfe",
    singleton: true,
  },
  entityType: "worker",
  eventHandlers: [
    {
      event: EventType.DISPATCH_HFE_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const hfeStorage = createWorkerDispatchHfeStorage();
    const hfeEntries = await hfeStorage.getByWorker(workerId);

    return {
      entries: hfeEntries.map((hfe) => ({
        workerId: hfe.workerId,
        category: HFE_CATEGORY,
        value: hfe.employerId,
      })),
    };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchHfeDenormPlugin);
