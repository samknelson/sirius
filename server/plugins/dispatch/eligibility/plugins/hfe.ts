import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const HFE_CATEGORY = "hfe";

/**
 * `dispatch_hfe` — READ side. Workers must either have no HFE entries OR one
 * matching this employer. The `hfe` facts are maintained by the `dispatch_hfe`
 * denorm plugin.
 */
export const dispatchHfePlugin: DispatchEligPlugin = {
  id: "dispatch_hfe",
  name: "Employer Priority",
  description: "Only includes workers who are being held for a specific employer",
  requiredComponent: "dispatch.hfe",

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: HFE_CATEGORY,
      type: "exists_or_none",
      value: context.employerId,
    };
  },
};

registerDispatchEligPlugin(dispatchHfePlugin);
