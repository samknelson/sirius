import { logger } from "../../logger";
import { createWorkerDispatchStatusStorage } from "../../storage/worker-dispatch-status";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";

const DISPSTATUS_CATEGORY = "dispstatus";
const AVAILABLE_VALUE = "Available";
const COMPONENT_ID = "dispatch";

export const dispatchStatusPlugin: DispatchEligPlugin = {
  id: "dispatch_status",
  name: "Dispatch Availability",
  description: "Only includes workers whose dispatch status is set to Available",
  componentId: "dispatch",
  backfill: () => backfillDispatchStatusEligibility(),

  eventHandlers: [
    {
      event: EventType.DISPATCH_STATUS_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    // Workers must have a dispstatus entry with value "Available"
    return {
      category: DISPSTATUS_CATEGORY,
      type: "exists",
      value: AVAILABLE_VALUE,
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const statusStorage = createWorkerDispatchStatusStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing dispatch status eligibility for worker ${workerId}`, {
      service: "dispatch-elig-status",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, DISPSTATUS_CATEGORY);

    const workerStatus = await statusStorage.getByWorker(workerId);

    if (!workerStatus || workerStatus.status !== "available") {
      logger.debug(`Worker ${workerId} is not available for dispatch`, {
        service: "dispatch-elig-status",
        workerId,
        status: workerStatus?.status || "no record",
      });
      return;
    }

    await eligStorage.create({
      workerId,
      category: DISPSTATUS_CATEGORY,
      value: AVAILABLE_VALUE,
    });

    logger.debug(`Created dispatch status eligibility entry for worker ${workerId}`, {
      service: "dispatch-elig-status",
      workerId,
    });
  },
};

export async function backfillDispatchStatusEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  if (!isCacheInitialized()) {
    logger.warn("Component cache not initialized, skipping dispatch status eligibility backfill", {
      service: "dispatch-elig-status",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug("dispatch component not enabled, skipping dispatch status backfill", {
      service: "dispatch-elig-status",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const statusStorage = createWorkerDispatchStatusStorage();
  const eligStorage = createWorkerDispatchEligDenormStorage();

  const allStatuses = await statusStorage.getAll();
  const availableWorkers = allStatuses.filter(s => s.status === "available");
  
  if (availableWorkers.length === 0) {
    logger.info("No workers with available dispatch status found for backfill", {
      service: "dispatch-elig-status",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  logger.info("Backfilling dispatch status eligibility for workers", {
    service: "dispatch-elig-status",
    workerCount: availableWorkers.length,
  });

  let entriesCreated = 0;

  for (const workerStatus of availableWorkers) {
    const existing = await eligStorage.getByWorkerAndCategory(workerStatus.workerId, DISPSTATUS_CATEGORY);
    if (existing.length === 0) {
      await eligStorage.create({
        workerId: workerStatus.workerId,
        category: DISPSTATUS_CATEGORY,
        value: AVAILABLE_VALUE,
      });
      entriesCreated++;
    }
  }

  logger.info("Completed dispatch status eligibility backfill", {
    service: "dispatch-elig-status",
    workersProcessed: availableWorkers.length,
    entriesCreated,
  });

  return { workersProcessed: availableWorkers.length, entriesCreated };
}
