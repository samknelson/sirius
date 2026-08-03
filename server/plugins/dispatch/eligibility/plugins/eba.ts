import { registerDispatchEligPlugin } from "../registry";
import { logger } from "../../../../logger";
import { createDispatchJobStorage } from "../../../../storage/dispatch/jobs";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";
import type { DispatchJobData } from "@shared/schema";

const EBA_CATEGORY = "eba";
const DISPSTATUS_CATEGORY = "dispstatus";
const AVAILABLE_VALUE = "Available";

/**
 * `dispatch_eba` — READ side. Passes workers who EITHER have a dispatch status
 * of "Available" (the `dispstatus` fact, maintained by the `dispatch_status`
 * denorm plugin) OR have marked themselves available for the job's start date
 * (the `eba` facts, maintained by the `dispatch_eba` denorm plugin).
 */
export const dispatchEbaPlugin: DispatchEligPlugin = {
  id: "dispatch_eba",
  name: "Employed but Available",
  description: "Requires workers to have dispatch status Available or to have marked themselves available for the job's start date",
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

    // Per-job override: when the job explicitly disallows EBA workers,
    // require dispatch status "Available" only (drop the EBA alternative).
    // Absent flag = allow (preserves existing behavior for all jobs).
    const jobData = (job.data ?? {}) as DispatchJobData;
    if (jobData.allowEbaWorkers === false) {
      return {
        category: DISPSTATUS_CATEGORY,
        type: "exists",
        value: AVAILABLE_VALUE,
      };
    }

    const startDate = String(job.startYmd).split(' ')[0].split('T')[0];

    return {
      category: EBA_CATEGORY,
      type: "exists_or_exists",
      value: startDate,
      orCategory: DISPSTATUS_CATEGORY,
      orValue: AVAILABLE_VALUE,
    };
  },
};

registerDispatchEligPlugin(dispatchEbaPlugin);
