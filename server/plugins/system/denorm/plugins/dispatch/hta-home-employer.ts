import { registerDenormPlugin } from "../../registry";
import type { DenormPlugin } from "../../types";
import { EventType } from "../../../../../services/event-bus";
import { createVariableStorage } from "../../../../../storage/system/variables";
import { createEmployerCompanyStorage } from "../../../../../storage/employers/companies";
import { createWorkerHoursStorage } from "../../../../../storage/worker-hours";
import {
  type DispatchEligDenormPayload,
  type DispatchEligEntry,
  dispatchEligBackfill,
  dispatchEligFindWidows,
  writeDispatchElig,
} from "./_shared";

const HTA_HOME_EMPLOYER_CATEGORY = "sitespecific:hta:home-employer";
const HTA_HOME_COMPANY_CATEGORY = "sitespecific:hta:home-company";
const VARIABLE_NAME = "sitespecific_hta_home_employment_statuses";

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
      // ignore malformed value
    }
  }
  return [];
}

/**
 * `dispatch_hta_home_employer` denorm plugin — maintains two fact categories
 * (`sitespecific:hta:home-employer` and `sitespecific:hta:home-company`) keyed
 * by `${ym}:${employerId|companyId}` over the worker's qualifying hours in the
 * current 3-month window. Both categories are owned by the same denorm row and
 * replaced together. Gated by the `sitespecific.hta` component.
 */
const dispatchHtaHomeEmployerDenormPlugin: DenormPlugin<DispatchEligDenormPayload> = {
  metadata: {
    id: "dispatch_hta_home_employer",
    name: "HTA Home Employer",
    description: "Prevents workers from being dispatched to their home employer",
    requiredComponent: "sitespecific.hta",
    singleton: true,
  },
  entityType: "worker",
  reads: ["workers", "variables", "workerHours", "employerCompanies"],
  writes: [{ storage: "workerDispatchEligDenorm", soleWriter: false }],
  eventHandlers: [
    {
      event: EventType.HOURS_SAVED,
      getEntityId: (payload) => (payload as { workerId: string }).workerId,
    },
  ],

  async compute(workerId: string): Promise<DispatchEligDenormPayload> {
    const statusIds = await getConfiguredStatusIds();
    if (statusIds.length === 0) {
      return { entries: [] };
    }

    const window = getCurrentThreeMonthWindow();
    const hoursStorage = createWorkerHoursStorage();
    const rows = await hoursStorage.getEmployerMonthRowsByWorkerStatusAndMonths(
      workerId,
      statusIds,
      window.map(({ year, month }) => ({ year, month })),
    );

    const uniquePairs = new Map<string, { year: number; month: number; employerId: string }>();
    for (const row of rows) {
      const key = `${row.year}-${String(row.month).padStart(2, "0")}:${row.employerId}`;
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { year: row.year, month: row.month, employerId: row.employerId });
      }
    }

    if (uniquePairs.size === 0) {
      return { entries: [] };
    }

    const ecStorage = createEmployerCompanyStorage();
    const employerCompanyMap = await ecStorage.getAllWithCompanyName();

    const employerEntries: DispatchEligEntry[] = [];
    const companyEntries: DispatchEligEntry[] = [];
    const seenCompanyKeys = new Set<string>();

    for (const { year, month, employerId } of Array.from(uniquePairs.values())) {
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

    return { entries: [...employerEntries, ...companyEntries] };
  },

  backfill: dispatchEligBackfill,
  findWidows: dispatchEligFindWidows,
  write: writeDispatchElig,
};

registerDenormPlugin(dispatchHtaHomeEmployerDenormPlugin);
