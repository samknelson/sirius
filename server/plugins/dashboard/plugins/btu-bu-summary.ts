import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import {
  bargainingUnits,
  workers,
  workerHours,
  optionsEmploymentStatus,
} from "@shared/schema";
import { cardchecks } from "@shared/schema/cardcheck/schema";
import { sql, countDistinct } from "drizzle-orm";

export const btuBuSummaryPlugin: DashboardPlugin = {
  id: "btu-bu-summary",
  name: "BTU Bargaining Unit Summary",
  description: "Display workers per bargaining unit with signed card check percentages",
  requiredComponent: "sitespecific.btu",
  requiredPolicy: "admin",
  needsReadOnlyDb: true,

  content: {
    data: async (ctx) => {
      const allBargainingUnits = await ctx.storage.bargainingUnits.getAllBargainingUnits();
      const buMinRateMap = new Map<string, number>();
      for (const bu of allBargainingUnits) {
        const buData = bu.data as { accountRates?: Record<string, unknown> } | null;
        if (!buData?.accountRates) continue;
        let minRate: number | null = null;
        for (const value of Object.values(buData.accountRates)) {
          if (typeof value === "number" && value > 0) {
            if (minRate === null || value < minRate) minRate = value;
          } else if (Array.isArray(value)) {
            for (const entry of value) {
              const r =
                typeof entry === "object" && entry !== null && "rate" in entry
                  ? (entry as { rate: number }).rate
                  : null;
              if (typeof r === "number" && r > 0 && (minRate === null || r < minRate)) {
                minRate = r;
              }
            }
          }
        }
        if (minRate !== null) {
          buMinRateMap.set(bu.id, minRate);
        }
      }

      const { units: buResults, unassigned: unassignedResults } =
        await ctx.storage.readOnly.query(async (client) => {
          const employedWorkerFilter = sql`${workers.id} IN (
            SELECT DISTINCT ON (wh.worker_id) wh.worker_id
            FROM ${workerHours} wh
            JOIN ${optionsEmploymentStatus} es ON es.id = wh.employment_status_id
            WHERE es.employed = true
            ORDER BY wh.worker_id, wh.year DESC, wh.month DESC, wh.day DESC
          )`;

          const summaryRows = await client
            .select({
              bargainingUnitId: bargainingUnits.id,
              bargainingUnitName: bargainingUnits.name,
              workerCount: countDistinct(workers.id).as("worker_count"),
              signedWorkerCount: sql<number>`count(distinct case when ${cardchecks.id} is not null then ${workers.id} end)`.as("signed_worker_count"),
            })
            .from(bargainingUnits)
            .leftJoin(workers, sql`${workers.bargainingUnitId} = ${bargainingUnits.id} AND ${employedWorkerFilter}`)
            .leftJoin(
              cardchecks,
              sql`${cardchecks.workerId} = ${workers.id} AND ${cardchecks.status} = 'signed'`
            )
            .groupBy(bargainingUnits.id, bargainingUnits.name)
            .orderBy(bargainingUnits.name);

          const [unassignedRow] = await client
            .select({
              workerCount: countDistinct(workers.id).as("worker_count"),
              signedWorkerCount: sql<number>`count(distinct case when ${cardchecks.id} is not null then ${workers.id} end)`.as("signed_worker_count"),
            })
            .from(workers)
            .leftJoin(
              cardchecks,
              sql`${cardchecks.workerId} = ${workers.id} AND ${cardchecks.status} = 'signed'`
            )
            .where(sql`${workers.bargainingUnitId} is null AND ${employedWorkerFilter}`);

          return {
            units: summaryRows.map((r) => ({
              bargainingUnitId: r.bargainingUnitId,
              bargainingUnitName: r.bargainingUnitName,
              workerCount: Number(r.workerCount ?? 0),
              signedWorkerCount: Number(r.signedWorkerCount ?? 0),
            })),
            unassigned: {
              workerCount: Number(unassignedRow?.workerCount ?? 0),
              signedWorkerCount: Number(unassignedRow?.signedWorkerCount ?? 0),
            },
          };
        });

      const unassignedWorkerCount = unassignedResults.workerCount;
      const unassignedSignedCount = unassignedResults.signedWorkerCount;
      const buWorkers = buResults.reduce((sum, r) => sum + r.workerCount, 0);
      const buSigned = buResults.reduce((sum, r) => sum + r.signedWorkerCount, 0);
      const totalWorkers = buWorkers + unassignedWorkerCount;
      const totalSigned = buSigned + unassignedSignedCount;

      const duesBuVar = await ctx.storage.variables.getByName("organizing_dues_bu_ids");
      const duesBuIds: string[] =
        duesBuVar && Array.isArray(duesBuVar.value) ? (duesBuVar.value as string[]) : [];
      const duesBuIdSet = duesBuIds.length > 0 ? new Set(duesBuIds) : null;

      let totalMissingDuesRevenue = 0;
      let hasDuesRates = false;

      const unitsMapped = buResults.map((r) => {
        const wc = Number(r.workerCount);
        const sc = Number(r.signedWorkerCount);
        const duesRate = buMinRateMap.get(r.bargainingUnitId) ?? null;
        const missingWorkers = wc - sc;
        const includedInDues = !duesBuIdSet || duesBuIdSet.has(r.bargainingUnitId);
        const missingRevenue =
          includedInDues && duesRate && missingWorkers > 0 ? missingWorkers * duesRate : null;
        if (duesRate) hasDuesRates = true;
        if (missingRevenue) totalMissingDuesRevenue += missingRevenue;
        return {
          id: r.bargainingUnitId,
          name: r.bargainingUnitName,
          workerCount: wc,
          signedCount: sc,
          percentage: wc > 0 ? Math.round((sc / wc) * 1000) / 10 : 0,
          duesRate,
          missingRevenue,
        };
      });

      return {
        units: unitsMapped,
        unassigned:
          unassignedWorkerCount > 0
            ? {
                workerCount: unassignedWorkerCount,
                signedCount: unassignedSignedCount,
                percentage:
                  unassignedWorkerCount > 0
                    ? Math.round((unassignedSignedCount / unassignedWorkerCount) * 1000) / 10
                    : 0,
              }
            : null,
        totals: {
          workerCount: totalWorkers,
          signedCount: totalSigned,
          percentage: totalWorkers > 0 ? Math.round((totalSigned / totalWorkers) * 1000) / 10 : 0,
          missingDuesRevenue: hasDuesRates ? totalMissingDuesRevenue : null,
        },
      };
    },
  },

  client: {
    component: "btu-bu-summary:BtuBuSummary",
    order: 10,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(btuBuSummaryPlugin);
