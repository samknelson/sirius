import { registerDispatchEligPlugin } from "../registry";
import { logger } from "../../../../logger";
import { createDispatchJobStorage } from "../../../../storage/dispatch/jobs";
import { createEmployerCompanyStorage } from "../../../../storage/employers/companies";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const HTA_HOME_EMPLOYER_CATEGORY = "sitespecific:hta:home-employer";
const HTA_HOME_COMPANY_CATEGORY = "sitespecific:hta:home-company";

function getThreeMonthWindow(refYear: number, refMonth: number): Array<{ year: number; month: number; ym: string }> {
  const months: Array<{ year: number; month: number; ym: string }> = [];
  for (let i = 0; i < 3; i++) {
    let m = refMonth - i;
    let y = refYear;
    while (m < 1) { m += 12; y--; }
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    months.push({ year: y, month: m, ym });
  }
  return months;
}

/**
 * `dispatch_hta_home_employer` — READ side. Prevents dispatching a worker to
 * their home employer (or any employer in the same company) over the current
 * 3-month window. The `sitespecific:hta:home-employer` /
 * `sitespecific:hta:home-company` facts are maintained by the matching denorm
 * plugin.
 */
export const dispatchHtaHomeEmployerPlugin: DispatchEligPlugin = {
  id: "dispatch_hta_home_employer",
  name: "HTA Home Employer",
  description: "Prevents workers from being dispatched to their home employer",
  requiredComponent: "sitespecific.hta",

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | EligibilityCondition[] | null> {
    const jobStorage = createDispatchJobStorage();
    const job = await jobStorage.getWithRelations(context.jobId);

    if (!job) {
      logger.warn(`Job not found for HTA home employer eligibility check`, {
        service: "dispatch-elig-hta-home-employer",
        jobId: context.jobId,
      });
      return null;
    }

    const startYmd = String(job.startYmd).split("T")[0].split(" ")[0];
    const [yearStr, monthStr] = startYmd.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month)) {
      logger.warn(`Invalid start date for HTA home employer eligibility`, {
        service: "dispatch-elig-hta-home-employer",
        jobId: context.jobId,
        startYmd,
      });
      return null;
    }

    const window = getThreeMonthWindow(year, month);
    const conditions: EligibilityCondition[] = [];

    const employerValues = window.map(({ ym }) => `${ym}:${job.employerId}`);
    conditions.push({
      category: HTA_HOME_EMPLOYER_CATEGORY,
      type: "not_exists",
      value: employerValues[0],
      values: employerValues,
    });

    const ecStorage = createEmployerCompanyStorage();
    const ec = await ecStorage.getByEmployerId(job.employerId);
    if (ec) {
      const companyValues = window.map(({ ym }) => `${ym}:${ec.companyId}`);
      conditions.push({
        category: HTA_HOME_COMPANY_CATEGORY,
        type: "not_exists",
        value: companyValues[0],
        values: companyValues,
      });
    }

    return conditions.length === 1 ? conditions[0] : conditions;
  },
};

registerDispatchEligPlugin(dispatchHtaHomeEmployerPlugin);
