import { logger } from "../../logger";
import { createWorkerDispatchHfeStorage } from "../../storage/worker-dispatch-hfe";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin } from "../dispatch-elig-plugin-registry";

const HFE_CATEGORY = "hfe";

export const dispatchHfePlugin: DispatchEligPlugin = {
  id: "dispatch_hfe",
  componentId: "dispatch.hfe",

  async recomputeWorker(workerId: string): Promise<void> {
    const hfeStorage = createWorkerDispatchHfeStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing HFE eligibility for worker ${workerId}`, {
      service: "dispatch-elig-hfe",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, HFE_CATEGORY);

    const hfeEntries = await hfeStorage.getByWorker(workerId);

    if (hfeEntries.length === 0) {
      logger.debug(`No HFE entries for worker ${workerId}`, {
        service: "dispatch-elig-hfe",
        workerId,
      });
      return;
    }

    const eligEntries = hfeEntries.map(hfe => ({
      workerId: hfe.workerId,
      category: HFE_CATEGORY,
      value: hfe.employerId,
    }));

    await eligStorage.createMany(eligEntries);

    logger.debug(`Created ${eligEntries.length} HFE eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-hfe",
      workerId,
      count: eligEntries.length,
    });
  },
};
