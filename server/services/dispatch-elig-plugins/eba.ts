import { logger } from "../../logger";
import { createWorkerDispatchEbaStorage } from "../../storage/worker-dispatch-eba";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import { createDispatchJobStorage } from "../../storage/dispatch-jobs";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";

const EBA_CATEGORY = "eba";
const COMPONENT_ID = "dispatch.eba";

export const dispatchEbaPlugin: DispatchEligPlugin = {
  id: "dispatch_eba",
  name: "Employed but Available",
  description: "Requires workers to have marked themselves available for the job's start date",
  componentId: COMPONENT_ID,

  eventHandlers: [
    {
      event: EventType.DISPATCH_EBA_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    const jobStorage = createDispatchJobStorage();
    const job = await jobStorage.getWithRelations(context.jobId);

    if (!job) {
      logger.warn(`Job not found for EBA eligibility check`, {
        service: "dispatch-elig-eba",
        jobId: context.jobId,
      });
      return null;
    }

    return {
      category: EBA_CATEGORY,
      type: "exists",
      value: job.startYmd,
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const ebaStorage = createWorkerDispatchEbaStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing EBA eligibility for worker ${workerId}`, {
      service: "dispatch-elig-eba",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, EBA_CATEGORY);

    if (!isCacheInitialized() || !isComponentEnabledSync(COMPONENT_ID)) {
      logger.debug(`dispatch.eba component disabled, cleared entries for worker ${workerId}`, {
        service: "dispatch-elig-eba",
        workerId,
      });
      return;
    }

    const ebaEntries = await ebaStorage.getByWorker(workerId);

    if (ebaEntries.length === 0) {
      logger.debug(`No EBA entries for worker ${workerId}`, {
        service: "dispatch-elig-eba",
        workerId,
      });
      return;
    }

    const eligEntries = ebaEntries.map(entry => ({
      workerId,
      category: EBA_CATEGORY,
      value: entry.date,
    }));

    await eligStorage.createMany(eligEntries);

    logger.debug(`Created ${eligEntries.length} EBA eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-eba",
      workerId,
      count: eligEntries.length,
    });
  },
};

export async function backfillDispatchEbaEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  if (!isCacheInitialized()) {
    logger.warn("Component cache not initialized, skipping EBA eligibility backfill", {
      service: "dispatch-elig-eba",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug("dispatch.eba component not enabled, skipping backfill", {
      service: "dispatch-elig-eba",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const ebaStorage = createWorkerDispatchEbaStorage();
  const allEntries = await ebaStorage.getAll();

  if (allEntries.length === 0) {
    logger.info("No EBA entries found for backfill", {
      service: "dispatch-elig-eba",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const uniqueWorkerIds = Array.from(new Set(allEntries.map(e => e.workerId)));

  logger.info(`Backfilling EBA eligibility for ${uniqueWorkerIds.length} workers with ${allEntries.length} EBA entries`, {
    service: "dispatch-elig-eba",
    workerCount: uniqueWorkerIds.length,
    entryCount: allEntries.length,
  });

  let entriesCreated = 0;
  for (const workerId of uniqueWorkerIds) {
    await dispatchEbaPlugin.recomputeWorker(workerId);
    const workerEntries = allEntries.filter(e => e.workerId === workerId);
    entriesCreated += workerEntries.length;
  }

  logger.info(`Completed EBA eligibility backfill`, {
    service: "dispatch-elig-eba",
    workersProcessed: uniqueWorkerIds.length,
    entriesCreated,
  });

  return { workersProcessed: uniqueWorkerIds.length, entriesCreated };
}
