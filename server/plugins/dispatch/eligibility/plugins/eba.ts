import { registerDispatchEligPlugin } from "../registry";
import { logger } from "../../../../logger";
import { createDispatchJobStorage } from "../../../../storage/dispatch/jobs";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const EBA_CATEGORY = "eba";

/**
 * `dispatch_eba` — READ side. Requires the worker to have marked themselves
 * available for the job's start date. The `eba` facts are maintained by the
 * `dispatch_eba` denorm plugin.
 */
export const dispatchEbaPlugin: DispatchEligPlugin = {
  id: "dispatch_eba",
  name: "Employed but Available",
  description: "Requires workers to have marked themselves available for the job's start date",
  requiredComponent: "dispatch.eba",

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

    const startDate = String(job.startYmd).split(' ')[0].split('T')[0];

    return {
      category: EBA_CATEGORY,
      type: "exists",
      value: startDate,
    };
  },
};

registerDispatchEligPlugin(dispatchEbaPlugin);
