import { logger } from "../../logger";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import { createVariableStorage } from "../../storage/variables";
import { createDispatchJobStorage } from "../../storage/dispatch/jobs";
import { createEmployerCompanyStorage } from "../../storage/companies";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";
import { getClient } from "../../storage/transaction-context";
import { workerHours } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const HTA_HOME_EMPLOYER_CATEGORY = "sitespecific:hta:home-employer";
const HTA_HOME_COMPANY_CATEGORY = "sitespecific:hta:home-company";
const VARIABLE_NAME = "sitespecific_hta_home_employment_statuses";
const COMPONENT_ID = "sitespecific.hta";

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

function getCurrentThreeMonthWindow(): Array<{ year: number; month: number; ym: string }> {
  const now = new Date();
  return getThreeMonthWindow(now.getFullYear(), now.getMonth() + 1);
}

async function getConfiguredStatusIds(): Promise<string[]> {
  const variableStorage = createVariableStorage();
  const variable = await variableStorage.getByName(VARIABLE_NAME);
  if (!variable || !variable.value) return [];
  const val = variable.value;
  if (Array.isArray(val)) return val.filter((v: unknown) => typeof v === "string" && v.length > 0);
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.filter((v: unknown) => typeof v === "string" && v.length > 0);
    } catch {
    }
  }
  return [];
}

export const dispatchHtaHomeEmployerPlugin: DispatchEligPlugin = {
  id: "dispatch_hta_home_employer",
  name: "HTA Home Employer",
  description: "Prevents workers from being dispatched to their home employer",
  componentId: COMPONENT_ID,

  async backfill(): Promise<{ workersProcessed: number; entriesCreated: number }> {
    if (!isCacheInitialized()) {
      logger.warn("Component cache not initialized, skipping HTA home employer eligibility backfill", {
        service: "dispatch-elig-hta-home-employer",
      });
      return { workersProcessed: 0, entriesCreated: 0 };
    }

    if (!isComponentEnabledSync(COMPONENT_ID)) {
      logger.debug("sitespecific.hta component not enabled, skipping HTA home employer backfill", {
        service: "dispatch-elig-hta-home-employer",
      });
      return { workersProcessed: 0, entriesCreated: 0 };
    }

    const eligStorage = createWorkerDispatchEligDenormStorage();
    const deletedEmployer = await eligStorage.deleteAllByCategory(HTA_HOME_EMPLOYER_CATEGORY);
    const deletedCompany = await eligStorage.deleteAllByCategory(HTA_HOME_COMPANY_CATEGORY);
    logger.info("Cleared existing HTA home employer eligibility entries before backfill", {
      service: "dispatch-elig-hta-home-employer",
      deletedEmployer,
      deletedCompany,
    });

    const statusIds = await getConfiguredStatusIds();
    if (statusIds.length === 0) {
      logger.info("No home employment statuses configured, skipping HTA home employer backfill", {
        service: "dispatch-elig-hta-home-employer",
      });
      return { workersProcessed: 0, entriesCreated: 0 };
    }

    const window = getCurrentThreeMonthWindow();
    const client = getClient();

    const monthConditions = window.map(
      ({ year, month }) => sql`(${workerHours.year} = ${year} AND ${workerHours.month} = ${month})`
    );

    const workerRows = await client
      .selectDistinct({ workerId: workerHours.workerId })
      .from(workerHours)
      .where(
        and(
          inArray(workerHours.employmentStatusId, statusIds),
          sql`(${sql.join(monthConditions, sql` OR `)})`
        )
      );

    const workerIds = workerRows.map((r) => r.workerId);

    if (workerIds.length === 0) {
      logger.info("No workers with qualifying hours found for HTA home employer backfill", {
        service: "dispatch-elig-hta-home-employer",
      });
      return { workersProcessed: 0, entriesCreated: 0 };
    }

    logger.info(`Backfilling HTA home employer eligibility for ${workerIds.length} workers`, {
      service: "dispatch-elig-hta-home-employer",
      workerCount: workerIds.length,
    });

    let entriesCreated = 0;
    for (const workerId of workerIds) {
      await this.recomputeWorker(workerId);
      const es = createWorkerDispatchEligDenormStorage();
      const employerEntries = await es.getByWorkerAndCategory(workerId, HTA_HOME_EMPLOYER_CATEGORY);
      const companyEntries = await es.getByWorkerAndCategory(workerId, HTA_HOME_COMPANY_CATEGORY);
      entriesCreated += employerEntries.length + companyEntries.length;
    }

    logger.info(`Completed HTA home employer eligibility backfill`, {
      service: "dispatch-elig-hta-home-employer",
      workersProcessed: workerIds.length,
      entriesCreated,
    });

    return { workersProcessed: workerIds.length, entriesCreated };
  },

  eventHandlers: [
    {
      event: EventType.HOURS_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

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

  async recomputeWorker(workerId: string): Promise<void> {
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing HTA home employer eligibility for worker ${workerId}`, {
      service: "dispatch-elig-hta-home-employer",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, HTA_HOME_EMPLOYER_CATEGORY);
    await eligStorage.deleteByWorkerAndCategory(workerId, HTA_HOME_COMPANY_CATEGORY);

    if (!isCacheInitialized() || !isComponentEnabledSync(COMPONENT_ID)) {
      logger.debug(`sitespecific.hta component disabled, cleared entries for worker ${workerId}`, {
        service: "dispatch-elig-hta-home-employer",
        workerId,
      });
      return;
    }

    const statusIds = await getConfiguredStatusIds();
    if (statusIds.length === 0) {
      logger.debug(`No home employment statuses configured, skipping worker ${workerId}`, {
        service: "dispatch-elig-hta-home-employer",
        workerId,
      });
      return;
    }

    const window = getCurrentThreeMonthWindow();
    const client = getClient();

    const monthConditions = window.map(
      ({ year, month }) => sql`(${workerHours.year} = ${year} AND ${workerHours.month} = ${month})`
    );

    const rows = await client
      .select({
        year: workerHours.year,
        month: workerHours.month,
        employerId: workerHours.employerId,
      })
      .from(workerHours)
      .where(
        and(
          eq(workerHours.workerId, workerId),
          inArray(workerHours.employmentStatusId, statusIds),
          sql`(${sql.join(monthConditions, sql` OR `)})`
        )
      );

    const uniquePairs = new Map<string, { year: number; month: number; employerId: string }>();
    for (const row of rows) {
      const key = `${row.year}-${String(row.month).padStart(2, "0")}:${row.employerId}`;
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { year: row.year, month: row.month, employerId: row.employerId });
      }
    }

    if (uniquePairs.size === 0) {
      logger.debug(`No qualifying hours for worker ${workerId} in 3-month window`, {
        service: "dispatch-elig-hta-home-employer",
        workerId,
      });
      return;
    }

    const ecStorage = createEmployerCompanyStorage();
    const employerCompanyMap = await ecStorage.getAllWithCompanyName();

    const employerEntries: Array<{ workerId: string; category: string; value: string }> = [];
    const companyEntries: Array<{ workerId: string; category: string; value: string }> = [];
    const seenCompanyKeys = new Set<string>();

    for (const [, { year, month, employerId }] of uniquePairs) {
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      employerEntries.push({
        workerId,
        category: HTA_HOME_EMPLOYER_CATEGORY,
        value: `${ym}:${employerId}`,
      });

      const ec = employerCompanyMap.get(employerId);
      if (ec) {
        const coKey = `${ym}:${ec.companyId}`;
        if (!seenCompanyKeys.has(coKey)) {
          seenCompanyKeys.add(coKey);
          companyEntries.push({
            workerId,
            category: HTA_HOME_COMPANY_CATEGORY,
            value: coKey,
          });
        }
      }
    }

    const allEntries = [...employerEntries, ...companyEntries];
    if (allEntries.length > 0) {
      await eligStorage.createMany(allEntries);
    }

    logger.debug(`Created ${allEntries.length} HTA home employer eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-hta-home-employer",
      workerId,
      employerEntries: employerEntries.length,
      companyEntries: companyEntries.length,
    });
  },
};
