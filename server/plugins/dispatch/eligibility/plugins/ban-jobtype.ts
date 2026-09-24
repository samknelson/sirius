import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const BAN_JOBTYPE_CATEGORY = "ban_jobtype";

/**
 * `dispatch_ban_jobtype` — READ side. Excludes workers with an active job-type
 * ban matching the job's job type. Inert when the job has no job type. The
 * `ban_jobtype` facts are maintained by the `dispatch_ban_jobtype` denorm
 * plugin.
 */
export const dispatchBanJobTypePlugin: DispatchEligPlugin = {
  id: "dispatch_ban_jobtype",
  name: "Job Type Ban",
  description: "Excludes workers banned from the job's job type",
  requiredComponent: "dispatch.ban",

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    if (!context.jobTypeId) return null;
    return {
      category: BAN_JOBTYPE_CATEGORY,
      type: "not_exists",
      value: context.jobTypeId,
      failureMessage: "Worker is banned from this job's job type",
    };
  },
};

registerDispatchEligPlugin(dispatchBanJobTypePlugin);
