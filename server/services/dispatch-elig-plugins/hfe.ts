import { logger } from "../../logger";
import { createWorkerDispatchHfeStorage } from "../../storage/worker-dispatch-hfe";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";

const HFE_CATEGORY = "hfe";

export const dispatchHfePlugin: DispatchEligPlugin = {
  id: "dispatch_hfe",
  name: "Hold for Employer",
  description: "Only includes workers who are being held for a specific employer",
  componentId: "dispatch.hfe",

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    // Workers must either have no HFE entries, OR have one matching this employer
    // This allows workers without any holds, plus workers specifically held for this employer
    return {
      category: HFE_CATEGORY,
      type: "exists_or_none",
      value: context.employerId,
    };
  },

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
