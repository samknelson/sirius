import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const DISPSTATUS_CATEGORY = "dispstatus";
const AVAILABLE_VALUE = "Available";

/**
 * `dispatch_status` — READ side. Only includes workers whose dispatch status is
 * "Available". The `dispstatus` fact is maintained by the `dispatch_status`
 * denorm plugin.
 */
export const dispatchStatusPlugin: DispatchEligPlugin = {
  id: "dispatch_status",
  name: "Dispatch Availability",
  description: "Only includes workers whose dispatch status is set to Available",
  requiredComponent: "dispatch",

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: DISPSTATUS_CATEGORY,
      type: "exists",
      value: AVAILABLE_VALUE,
    };
  },
};

registerDispatchEligPlugin(dispatchStatusPlugin);
