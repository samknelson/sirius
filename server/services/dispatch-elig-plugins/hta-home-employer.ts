import { logger } from "../../logger";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import { createVariableStorage } from "../../storage/variables";
import { createDispatchJobStorage } from "../../storage/dispatch-jobs";
import { createEmployerCompanyStorage } from "../../storage/companies";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import { isComponentEnabledSync, isCacheInitialized } from "../component-cache";
import { getClient } from "../../storage/transaction-context";
import { workerHours } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const HTA_HOME_EMPLOYER_CATEGORY = "sitespecific:hta:home-employer";
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
  try {
    const parsed = JSON.parse(variable.value);
    if (Array.isArray(parsed)) return parsed.filter((v: unknown) => typeof v === "string" && v.length > 0);
  } catch {
    // not valid JSON
  }
  return [];
}

export const dispatchHtaHomeEmployerPlugin: DispatchEligPlugin = {
  id: "dispatch_hta_home_employer",
  name: "HTA Home Employer",
  description: "Prevents workers from being dispatched to their home employer",
  componentId: COMPONENT_ID,

  eventHandlers: [
    {
      event: EventType.HOURS_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
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
    const values: string[] = [];

    for (const { ym } of window) {
      values.push(`${ym}:${job.employerId}`);
    }

    const ecStorage = createEmployerCompanyStorage();
    const ec = await ecStorage.getByEmployerId(job.employerId);
    if (ec) {
      for (const { ym } of window) {
        values.push(`co:${ym}:${ec.companyId}`);
      }
    }

    if (values.length === 0) return null;

    return {
      category: HTA_HOME_EMPLOYER_CATEGORY,
      type: "not_exists",
      value: values[0],
      values,
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing HTA home employer eligibility for worker ${workerId}`, {
      service: "dispatch-elig-hta-home-employer",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, HTA_HOME_EMPLOYER_CATEGORY);

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

    const entries: Array<{ workerId: string; category: string; value: string }> = [];
    const companyEntries = new Set<string>();

    for (const [, { year, month, employerId }] of uniquePairs) {
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      entries.push({
        workerId,
        category: HTA_HOME_EMPLOYER_CATEGORY,
        value: `${ym}:${employerId}`,
      });

      const ec = employerCompanyMap.get(employerId);
      if (ec) {
        const coKey = `co:${ym}:${ec.companyId}`;
        if (!companyEntries.has(coKey)) {
          companyEntries.add(coKey);
          entries.push({
            workerId,
            category: HTA_HOME_EMPLOYER_CATEGORY,
            value: coKey,
          });
        }
      }
    }

    if (entries.length > 0) {
      await eligStorage.createMany(entries);
    }

    logger.debug(`Created ${entries.length} HTA home employer eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-hta-home-employer",
      workerId,
      entryCount: entries.length,
    });
  },
};

export async function backfillHtaHomeEmployerEligibility(): Promise<{ workersProcessed: number; entriesCreated: number }> {
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
    await dispatchHtaHomeEmployerPlugin.recomputeWorker(workerId);
    const eligStorage = createWorkerDispatchEligDenormStorage();
    const entries = await eligStorage.getByWorkerAndCategory(workerId, HTA_HOME_EMPLOYER_CATEGORY);
    entriesCreated += entries.length;
  }

  logger.info(`Completed HTA home employer eligibility backfill`, {
    service: "dispatch-elig-hta-home-employer",
    workersProcessed: workerIds.length,
    entriesCreated,
  });

  return { workersProcessed: workerIds.length, entriesCreated };
}
