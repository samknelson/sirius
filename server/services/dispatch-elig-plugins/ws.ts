import { logger } from "../../logger";
import { storage } from "../../storage";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";

const WS_CATEGORY = "ws";
const COMPONENT_ID = "dispatch";

interface WsPluginConfig {
  eligibleWorkStatuses?: string[];
}

export const dispatchWsPlugin: DispatchEligPlugin = {
  id: "dispatch_ws",
  name: "Work Status",
  description: "Filters workers based on eligible work statuses configured per job type",
  componentId: COMPONENT_ID,

  eventHandlers: [
    {
      event: EventType.WORKER_WS_CHANGED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  configFields: [
    {
      name: "eligibleWorkStatuses",
      label: "Eligible Work Statuses",
      inputType: "select-options",
      required: false,
      helperText: "Work statuses eligible for jobs of this type (leave empty for all)",
      selectOptionsType: "worker-ws",
      multiSelect: true,
    },
  ],

  async getEligibilityCondition(_context: EligibilityQueryContext, config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    const pluginConfig = config as WsPluginConfig;
    const eligibleWorkStatuses = pluginConfig?.eligibleWorkStatuses || [];

    if (eligibleWorkStatuses.length === 0) {
      logger.debug(`No eligible work statuses configured, all workers eligible`, {
        service: "dispatch-elig-ws",
        jobId: _context.jobId,
      });
      return null;
    }

    logger.debug(`Plugin requires specific work statuses for eligibility`, {
      service: "dispatch-elig-ws",
      jobId: _context.jobId,
      eligibleWorkStatusCount: eligibleWorkStatuses.length,
    });

    return {
      category: WS_CATEGORY,
      type: "exists",
      value: eligibleWorkStatuses.join(","),
      values: eligibleWorkStatuses,
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing work status eligibility for worker ${workerId}`, {
      service: "dispatch-elig-ws",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, WS_CATEGORY);

    const worker = await storage.workers.getWorker(workerId);

    if (!worker || !worker.denormWsId) {
      logger.debug(`No work status for worker ${workerId}`, {
        service: "dispatch-elig-ws",
        workerId,
      });
      return;
    }

    await eligStorage.create({
      workerId,
      category: WS_CATEGORY,
      value: worker.denormWsId,
    });

    logger.debug(`Created work status eligibility entry for worker ${workerId}`, {
      service: "dispatch-elig-ws",
      workerId,
      wsId: worker.denormWsId,
    });
  },
};

export async function backfillDispatchWsEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
  if (!isCacheInitialized()) {
    logger.warn("Component cache not initialized, skipping work status eligibility backfill", {
      service: "dispatch-elig-ws",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  if (!isComponentEnabledSync(COMPONENT_ID)) {
    logger.debug("dispatch component not enabled, skipping work status backfill", {
      service: "dispatch-elig-ws",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  const allWorkers = await storage.workers.getWorkersWithDetails();
  
  const workersWithStatus = allWorkers.filter((w: { denorm_ws_id: string | null }) => w.denorm_ws_id);
  
  if (workersWithStatus.length === 0) {
    logger.info("No workers with work status found for backfill", {
      service: "dispatch-elig-ws",
    });
    return { workersProcessed: 0, entriesCreated: 0 };
  }

  logger.info("Backfilling work status eligibility for workers", {
    service: "dispatch-elig-ws",
    workerCount: workersWithStatus.length,
  });

  let entriesCreated = 0;

  for (const worker of workersWithStatus) {
    await dispatchWsPlugin.recomputeWorker(worker.id);
    entriesCreated++;
  }

  logger.info("Completed work status eligibility backfill", {
    service: "dispatch-elig-ws",
    workersProcessed: workersWithStatus.length,
    entriesCreated,
  });

  return { workersProcessed: workersWithStatus.length, entriesCreated };
}
