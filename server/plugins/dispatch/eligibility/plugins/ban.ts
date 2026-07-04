import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const BAN_CATEGORY = "ban";

/**
 * `dispatch_ban` — READ side. Excludes workers with an active dispatch ban. The
 * `ban` facts are maintained by the `dispatch_ban` denorm plugin.
 */
export const dispatchBanPlugin: DispatchEligPlugin = {
  id: "dispatch_ban",
  name: "Worker Ban",
  description: "Excludes workers who have an active dispatch ban",
  requiredComponent: "dispatch.ban",

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: BAN_CATEGORY,
      type: "not_exists_category",
      value: "dispatch:*",
    };
  },
};

registerDispatchEligPlugin(dispatchBanPlugin);
