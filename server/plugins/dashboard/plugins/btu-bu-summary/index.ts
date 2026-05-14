import type { DashboardPlugin } from "../../types";

export const btuBuSummaryPlugin: DashboardPlugin = {
  id: "btu-bu-summary",
  name: "BTU Bargaining Unit Summary",
  description: "Display workers per bargaining unit with signed card check percentages",
  componentId: "sitespecific.btu",

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
        await ctx.storage.bargainingUnits.getCardcheckSummary();

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
};
