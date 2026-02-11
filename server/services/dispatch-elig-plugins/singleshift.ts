import { logger } from "../../logger";
import { createDispatchStorage } from "../../storage/dispatches";
import { createDispatchJobStorage } from "../../storage/dispatch-jobs";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";

const SINGLESHIFT_CATEGORY = "singleshift";
const ACCEPTED_CATEGORY = "accepted";
const COMPONENT_ID = "dispatch.singleshift";

export const dispatchSingleshiftPlugin: DispatchEligPlugin = {
  id: "dispatch_singleshift",
  name: "Single Shift Dispatch",
  description: "Prevents a worker from accepting two dispatches that start on the same date",
  componentId: COMPONENT_ID,

  eventHandlers: [
    {
      event: EventType.DISPATCH_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    const jobStorage = createDispatchJobStorage();
    const job = await jobStorage.getWithRelations(context.jobId);

    if (!job) {
      logger.warn(`Job not found for singleshift eligibility check`, {
        service: "dispatch-elig-singleshift",
        jobId: context.jobId,
      });
      return null;
    }

    return {
      category: SINGLESHIFT_CATEGORY,
      type: "not_exists_unless_exists",
      value: job.startYmd,
      unlessCategory: ACCEPTED_CATEGORY,
      unlessValue: job.id,
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const dispatchStorage = createDispatchStorage();
    const jobStorage = createDispatchJobStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing singleshift eligibility for worker ${workerId}`, {
      service: "dispatch-elig-singleshift",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, SINGLESHIFT_CATEGORY);
    await eligStorage.deleteByWorkerAndCategory(workerId, ACCEPTED_CATEGORY);

    if (!isCacheInitialized() || !isComponentEnabledSync(COMPONENT_ID)) {
      logger.debug(`dispatch.singleshift component disabled, cleared entries for worker ${workerId}`, {
        service: "dispatch-elig-singleshift",
        workerId,
      });
      return;
    }

    const allDispatches = await dispatchStorage.getByWorker(workerId);
    const acceptedDispatches = allDispatches.filter(d => d.status === "accepted");

    if (acceptedDispatches.length === 0) {
      logger.debug(`No accepted dispatches for worker ${workerId}`, {
        service: "dispatch-elig-singleshift",
        workerId,
      });
      return;
    }

    const singleshiftEntries: { workerId: string; category: string; value: string }[] = [];
    const acceptedEntries: { workerId: string; category: string; value: string }[] = [];

    for (const dispatch of acceptedDispatches) {
      const job = await jobStorage.getWithRelations(dispatch.jobId);
      if (job) {
        singleshiftEntries.push({
          workerId,
          category: SINGLESHIFT_CATEGORY,
          value: job.startYmd,
        });
        acceptedEntries.push({
          workerId,
          category: ACCEPTED_CATEGORY,
          value: job.id,
        });
      }
    }

    const allEntries = [...singleshiftEntries, ...acceptedEntries];
    if (allEntries.length > 0) {
      await eligStorage.createMany(allEntries);
    }

    logger.debug(`Created ${singleshiftEntries.length} singleshift + ${acceptedEntries.length} accepted eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-singleshift",
      workerId,
      singleshiftCount: singleshiftEntries.length,
      acceptedCount: acceptedEntries.length,
    });
  },
};

export async function backfillDispatchSingleshiftEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  if (!isCacheInitialized()) {
    logger.warn("Component cache not initialized, skipping singleshift eligibility backfill", {
      service: "dispatch-elig-singleshift",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug("dispatch.singleshift component not enabled, skipping backfill", {
      service: "dispatch-elig-singleshift",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const dispatchStorage = createDispatchStorage();
  const allDispatches = await dispatchStorage.getAll();
  const acceptedDispatches = allDispatches.filter(d => d.status === "accepted");

  if (acceptedDispatches.length === 0) {
    logger.info("No accepted dispatches found for singleshift backfill", {
      service: "dispatch-elig-singleshift",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const uniqueWorkerIds = Array.from(new Set(acceptedDispatches.map(d => d.workerId)));

  logger.info(`Backfilling singleshift eligibility for ${uniqueWorkerIds.length} workers with ${acceptedDispatches.length} accepted dispatches`, {
    service: "dispatch-elig-singleshift",
    workerCount: uniqueWorkerIds.length,
    dispatchCount: acceptedDispatches.length,
  });

  let entriesCreated = 0;
  for (const workerId of uniqueWorkerIds) {
    await dispatchSingleshiftPlugin.recomputeWorker(workerId);
    const workerDispatches = acceptedDispatches.filter(d => d.workerId === workerId);
    entriesCreated += workerDispatches.length * 2;
  }

  logger.info(`Completed singleshift eligibility backfill`, {
    service: "dispatch-elig-singleshift",
    workersProcessed: uniqueWorkerIds.length,
    entriesCreated,
  });

  return { workersProcessed: uniqueWorkerIds.length, entriesCreated };
}
