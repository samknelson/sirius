import { registerDispatchEligPlugin } from "../registry";
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

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    const job = context.job;

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
