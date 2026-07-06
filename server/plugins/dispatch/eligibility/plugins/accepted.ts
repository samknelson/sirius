import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

/**
 * `dispatch_accepted` — READ side. Has no eligibility condition of its own;
 * other plugins (singleshift) read its `accepted` facts at query time. The
 * facts are maintained by the `dispatch_accepted` denorm plugin.
 */
export const dispatchAcceptedPlugin: DispatchEligPlugin = {
  id: "dispatch_accepted",
  name: "Accepted Dispatch Tracker",
  description: "Maintains denormalized records of which jobs each worker has accepted. Used by other plugins for exemption logic.",
  hidden: true,

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return null;
  },
};

registerDispatchEligPlugin(dispatchAcceptedPlugin);
