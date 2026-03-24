import { logger } from "../../logger";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";

const HTA_HOME_EMPLOYER_CATEGORY = "hta_home_employer";
const COMPONENT_ID = "sitespecific.hta";

export const dispatchHtaHomeEmployerPlugin: DispatchEligPlugin = {
  id: "dispatch_hta_home_employer",
  name: "HTA Home Employer",
  description: "Prevents workers from being dispatched to their home employer",
  componentId: COMPONENT_ID,

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return null;
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing HTA home employer eligibility for worker ${workerId}`, {
      service: "dispatch-elig-hta-home-employer",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, HTA_HOME_EMPLOYER_CATEGORY);
  },
};
