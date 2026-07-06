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

const ACCEPTED_CATEGORY = "accepted";

/**
 * `dispatch_accepted` denorm plugin — maintains the `accepted` facts in
 * `worker_dispatch_elig_denorm` (which jobs a worker has accepted). It has no
 * eligibility query condition of its own; other plugins (singleshift) read its
 * facts at query time. Denorm-only and hidden from the job-type-config UI.
 */
const dispatchAcceptedDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_accepted",
    name: "Accepted Dispatch Tracker",
    description:
      "Maintains denormalized records of which jobs each worker has accepted. Used by other plugins for exemption logic.",
    hidden: true,
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
        entries.push({ workerId, category: ACCEPTED_CATEGORY, value: job.id });
      }
    }

    return { entries };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchAcceptedDenormPlugin);
