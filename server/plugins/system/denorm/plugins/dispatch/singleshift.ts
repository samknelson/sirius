import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createDispatchStorage } from "../../../../../storage/dispatch/dispatches";
import { createDispatchJobStorage } from "../../../../../storage/dispatch/jobs";
import {
  type DispatchEligDenormPayload,
  type DispatchEligEntry,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const SINGLESHIFT_CATEGORY = "singleshift";

/**
 * `dispatch_singleshift` denorm plugin — maintains the `singleshift` facts (one
 * per start date a worker already has an accepted dispatch for). Gated by the
 * `dispatch.singleshift` component.
 */
const dispatchSingleshiftDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_singleshift",
    name: "Single Shift Dispatch",
    description: "Prevents a worker from accepting two dispatches that start on the same date",
    requiredComponent: "dispatch.singleshift",
    singleton: true,
  },
  entityType: "worker",
  eventHandlers: [
    {
      event: EventType.DISPATCH_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const dispatchStorage = createDispatchStorage();
    const jobStorage = createDispatchJobStorage();

    const allDispatches = await dispatchStorage.getByWorker(workerId);
    const acceptedDispatches = allDispatches.filter((d) => d.status === "accepted");

    const entries: DispatchEligEntry[] = [];
    for (const dispatch of acceptedDispatches) {
      const job = await jobStorage.getWithRelations(dispatch.jobId);
      if (job) {
        entries.push({
          workerId,
          category: SINGLESHIFT_CATEGORY,
          value: String(job.startYmd).split(" ")[0].split("T")[0],
        });
      }
    }

    return { entries };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchSingleshiftDenormPlugin);
