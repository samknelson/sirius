import { registerDispatchEligPlugin } from "../registry";
import { logger } from "../../../../logger";
import { createDispatchJobStorage } from "../../../../storage/dispatch/jobs";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const SINGLESHIFT_CATEGORY = "singleshift";
const ACCEPTED_CATEGORY = "accepted";

/**
 * `dispatch_singleshift` — READ side. Prevents a worker from accepting two
 * dispatches starting on the same date (unless they already accepted this exact
 * job). Reads `singleshift` + `accepted` facts maintained by the matching denorm
 * plugins.
 */
export const dispatchSingleshiftPlugin: DispatchEligPlugin = {
  id: "dispatch_singleshift",
  name: "Single Shift Dispatch",
  description: "Prevents a worker from accepting two dispatches that start on the same date",
  requiredComponent: "dispatch.singleshift",

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
      value: String(job.startYmd).split(' ')[0].split('T')[0],
      unlessCategory: ACCEPTED_CATEGORY,
      unlessValue: job.id,
    };
  },
};

registerDispatchEligPlugin(dispatchSingleshiftPlugin);
