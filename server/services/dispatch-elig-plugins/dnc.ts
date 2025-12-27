import { logger } from "../../logger";
import { createWorkerDispatchDncStorage } from "../../storage/worker-dispatch-dnc";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin } from "../dispatch-elig-plugin-registry";

const DNC_CATEGORY = "dnc";

export const dispatchDncPlugin: DispatchEligPlugin = {
  id: "dispatch_dnc",
  componentId: "dispatch.dnc",

  async recomputeWorker(workerId: string): Promise<void> {
    const dncStorage = createWorkerDispatchDncStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing DNC eligibility for worker ${workerId}`, {
      service: "dispatch-elig-dnc",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, DNC_CATEGORY);

    const dncEntries = await dncStorage.getByWorker(workerId);

    if (dncEntries.length === 0) {
      logger.debug(`No DNC entries for worker ${workerId}`, {
        service: "dispatch-elig-dnc",
        workerId,
      });
      return;
    }

    const eligEntries = dncEntries.map(dnc => ({
      workerId: dnc.workerId,
      category: DNC_CATEGORY,
      value: dnc.employerId,
    }));

    await eligStorage.createMany(eligEntries);

    logger.debug(`Created ${eligEntries.length} DNC eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-dnc",
      workerId,
      count: eligEntries.length,
    });
  },
};
