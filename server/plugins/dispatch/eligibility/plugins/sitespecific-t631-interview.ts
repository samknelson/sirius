import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const INTERVIEW_CATEGORY = "t631_interview";

/**
 * `sitespecific_t631_interview` — READ side. A worker is only eligible for a
 * job if they have PASSED the interview for THAT job (fact value = jobId).
 * The `t631_interview` facts are maintained by the `sitespecific_t631_interview`
 * denorm plugin.
 */
export const t631InterviewPlugin: DispatchEligPlugin = {
  id: "sitespecific_t631_interview",
  name: "T631 Interview",
  description: "Only includes workers who have passed the interview for this job",
  requiredComponent: "sitespecific.t631.interviews",

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: INTERVIEW_CATEGORY,
      type: "exists",
      value: context.jobId,
      failureMessage: "Has not passed the interview for this job",
    };
  },
};

registerDispatchEligPlugin(t631InterviewPlugin);
