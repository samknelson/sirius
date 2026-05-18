import type { DashboardPlugin } from "../types";

export const btuDuesStatusPlugin: DashboardPlugin = {
  id: "btu-dues-status",
  name: "BTU Dues Status",
  description:
    "Display summary of most recent BTU dues allocation import with card check comparison",
  requiredComponent: "sitespecific.btu",
  requiredPolicy: "admin",

  content: {
    summary: async (ctx) => {
      const wizards = await ctx.storage.wizards.list({ type: "btu_dues_allocation" });
      if (wizards.length === 0) {
        return { hasData: false };
      }

      const latest = wizards[0];
      const data = latest.data as Record<string, any> | null;
      const processResults = data?.processResults as
        | {
            totalRows?: number;
            createdCount?: number;
            successCount?: number;
            failureCount?: number;
            completedAt?: string;
          }
        | null;
      const skippedDuplicateCount = data?.skippedDuplicateCount as number | undefined;
      const transactionDates = data?.transactionDates as string[] | undefined;
      const comparisonReport = data?.cardCheckComparisonReport as
        | {
            matchingRate?: any[];
            mismatchingRate?: any[];
            noCardCheck?: any[];
            cardCheckMissingRate?: any[];
            cardCheckNoAllocation?: any[];
            workerNotFound?: any[];
          }
        | null;

      return {
        hasData: true,
        wizardId: latest.id,
        wizardName: (data?.wizardName as string) || latest.type,
        status: latest.status,
        date: latest.date,
        processResults: processResults
          ? {
              totalRows: processResults.totalRows ?? 0,
              successCount: processResults.successCount ?? 0,
              failureCount: processResults.failureCount ?? 0,
              completedAt: processResults.completedAt ?? null,
            }
          : null,
        skippedDuplicateCount: skippedDuplicateCount ?? 0,
        transactionDates: transactionDates || [],
        comparisonReport: comparisonReport
          ? {
              matchingRate: comparisonReport.matchingRate?.length ?? 0,
              mismatchingRate: comparisonReport.mismatchingRate?.length ?? 0,
              noCardCheck: comparisonReport.noCardCheck?.length ?? 0,
              cardCheckMissingRate: comparisonReport.cardCheckMissingRate?.length ?? 0,
              cardCheckNoAllocation: comparisonReport.cardCheckNoAllocation?.length ?? 0,
              workerNotFound: comparisonReport.workerNotFound?.length ?? 0,
            }
          : null,
      };
    },
  },

  client: {
    component: "btu-dues-status:BtuDuesStatus",
    order: 9,
    requiredPermissions: ["admin"],
  },
};
