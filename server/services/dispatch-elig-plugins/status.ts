import { logger } from "../../logger";
import { createWorkerDispatchStatusStorage } from "../../storage/worker-dispatch-status";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin } from "../dispatch-elig-plugin-registry";

const DISPSTATUS_CATEGORY = "dispstatus";
const AVAILABLE_VALUE = "Available";

export const dispatchStatusPlugin: DispatchEligPlugin = {
  id: "dispatch_status",
  componentId: "dispatch",

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
