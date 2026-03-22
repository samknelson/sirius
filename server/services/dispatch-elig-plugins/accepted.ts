import { logger } from "../../logger";
import { createDispatchStorage } from "../../storage/dispatches";
import { createDispatchJobStorage } from "../../storage/dispatch-jobs";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";

const ACCEPTED_CATEGORY = "accepted";

export const dispatchAcceptedPlugin: DispatchEligPlugin = {
  id: "dispatch_accepted",
  name: "Accepted Dispatch Tracker",
  description: "Maintains denormalized records of which jobs each worker has accepted. Used by other plugins for exemption logic.",
  hidden: true,

  eventHandlers: [
    {
      event: EventType.DISPATCH_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  async getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    return null;
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const dispatchStorage = createDispatchStorage();
    const jobStorage = createDispatchJobStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing accepted eligibility for worker ${workerId}`, {
      service: "dispatch-elig-accepted",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, ACCEPTED_CATEGORY);

    const allDispatches = await dispatchStorage.getByWorker(workerId);
    const acceptedDispatches = allDispatches.filter(d => d.status === "accepted");

    if (acceptedDispatches.length === 0) {
      logger.debug(`No accepted dispatches for worker ${workerId}`, {
        service: "dispatch-elig-accepted",
        workerId,
      });
      return;
    }

    const entries: { workerId: string; category: string; value: string }[] = [];

    for (const dispatch of acceptedDispatches) {
      const job = await jobStorage.getWithRelations(dispatch.jobId);
      if (job) {
        entries.push({
          workerId,
          category: ACCEPTED_CATEGORY,
          value: job.id,
        });
      }
    }

    if (entries.length > 0) {
      await eligStorage.createMany(entries);
    }

    logger.debug(`Created ${entries.length} accepted eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-accepted",
      workerId,
      count: entries.length,
    });
  },
};

export async function backfillDispatchAcceptedEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  const dispatchStorage = createDispatchStorage();
  const allDispatches = await dispatchStorage.getAll();
  const acceptedDispatches = allDispatches.filter(d => d.status === "accepted");

  if (acceptedDispatches.length === 0) {
    logger.info("No accepted dispatches found for accepted backfill", {
      service: "dispatch-elig-accepted",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const uniqueWorkerIds = Array.from(new Set(acceptedDispatches.map(d => d.workerId)));

  logger.info(`Backfilling accepted eligibility for ${uniqueWorkerIds.length} workers with ${acceptedDispatches.length} accepted dispatches`, {
    service: "dispatch-elig-accepted",
    workerCount: uniqueWorkerIds.length,
    dispatchCount: acceptedDispatches.length,
  });

  let entriesCreated = 0;
  for (const workerId of uniqueWorkerIds) {
    await dispatchAcceptedPlugin.recomputeWorker(workerId);
    const workerDispatches = acceptedDispatches.filter(d => d.workerId === workerId);
    entriesCreated += workerDispatches.length;
  }

  logger.info(`Completed accepted eligibility backfill`, {
    service: "dispatch-elig-accepted",
    workersProcessed: uniqueWorkerIds.length,
    entriesCreated,
  });

  return { workersProcessed: uniqueWorkerIds.length, entriesCreated };
}
