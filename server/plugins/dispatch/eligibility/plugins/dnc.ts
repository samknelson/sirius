import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const DNC_CATEGORY = "dnc";

/**
 * `dispatch_dnc` — READ side. Excludes workers with a Do-Not-Call entry for the
 * job's employer. The `dnc` facts are maintained by the `dispatch_dnc` denorm
 * plugin.
 */
export const dispatchDncPlugin: DispatchEligPlugin = {
  id: "dispatch_dnc",
  name: "Do Not Call",
  description: "Excludes workers who have a Do Not Call entry for the job's employer",
  requiredComponent: "dispatch.dnc",

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: DNC_CATEGORY,
      type: "not_exists",
      value: context.employerId,
    };
  },
};

registerDispatchEligPlugin(dispatchDncPlugin);
