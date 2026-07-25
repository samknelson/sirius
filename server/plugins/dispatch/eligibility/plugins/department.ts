import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";
import { storage } from "../../../../storage";

const DEPT_INCLUDE_CATEGORY = "dept_include";
const DEPT_EXCLUDE_CATEGORY = "dept_exclude";

/**
 * `dispatch_department` — READ side. Filters workers by department preference
 * against the job's (optional) department:
 *
 * - Job HAS department D:
 *   - workers with an exclude entry for D are ineligible;
 *   - workers with include entries are eligible only if D is one of them;
 *   - workers with no department entries are eligible.
 * - Job has NO department:
 *   - workers with ANY include entries are ineligible (they opted into a
 *     specific set of departments, and a no-department job isn't in it);
 *   - exclude-mode and no-preference workers are eligible.
 *
 * The `dept_include` / `dept_exclude` facts are maintained by the
 * `dispatch_department` denorm plugin.
 */
export const dispatchDepartmentPlugin: DispatchEligPlugin = {
  id: "dispatch_department",
  name: "Department Preferences",
  description: "Filters workers by their department include/exclude preferences against the job's department",
  requiredComponent: "dispatch.department",

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition[] | null> {
    const jobDepartment = await storage.dispatchJobDepartments.getByJob(context.jobId);

    if (!jobDepartment) {
      return [
        {
          category: DEPT_INCLUDE_CATEGORY,
          type: "not_exists_category",
          value: "",
          failureMessage:
            "The worker has a preference to only work in specific departments, and this job has no department",
        },
      ];
    }

    const departmentLabel = jobDepartment.department?.name || jobDepartment.departmentId;

    return [
      {
        category: DEPT_EXCLUDE_CATEGORY,
        type: "not_exists",
        value: jobDepartment.departmentId,
        failureMessage: `The worker has a preference to not work in department [${departmentLabel}]`,
      },
      {
        category: DEPT_INCLUDE_CATEGORY,
        type: "exists_or_none",
        value: jobDepartment.departmentId,
        failureMessage: `The worker has a preference to only work in specific departments not including [${departmentLabel}]`,
      },
    ];
  },
};

registerDispatchEligPlugin(dispatchDepartmentPlugin);
