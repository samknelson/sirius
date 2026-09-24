import { registerDispatchEligPlugin } from "../registry";
import { isComponentEnabled } from "../../../../modules/components";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const BAN_FACILITY_CATEGORY = "ban_facility";

/**
 * `dispatch_ban_facility` — READ side. Excludes workers with an active
 * facility ban matching the job's linked facility (dispatch_job_facility,
 * owned by the dispatch.facility component). Inert when the component is
 * disabled or the job has no facility. The `ban_facility` facts are
 * maintained by the `dispatch_ban_facility` denorm plugin.
 */
export const dispatchBanFacilityPlugin: DispatchEligPlugin = {
  id: "dispatch_ban_facility",
  name: "Facility Ban",
  description: "Excludes workers banned from the job's facility",
  requiredComponent: "dispatch.ban",

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    if (!(await isComponentEnabled("dispatch.facility"))) return null;
    const link = context.facilityLink;
    if (!link?.facilityId) return null;
    return {
      category: BAN_FACILITY_CATEGORY,
      type: "not_exists",
      value: link.facilityId,
      failureMessage: "Worker is banned from this job's facility",
    };
  },
};

registerDispatchEligPlugin(dispatchBanFacilityPlugin);
