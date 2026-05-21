import type { DashboardPlugin } from "../types";

export const edlsSummaryPlugin: DashboardPlugin = {
  id: "edls-summary",
  name: "EDLS Daily Summary",
  description:
    "Worker assignment counts by member status and sheet status for a selected day",
  componentId: "edls",
  requiredPolicy: "edls.coordinator",

  async content(ctx) {
    const ymd = ctx.query.ymd;
    if (!ymd || typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw Object.assign(new Error("ymd query parameter required in YYYY-MM-DD format"), {
        status: 400,
      });
    }

    const result = await ctx.storage.edlsAssignments.getDailySummaryByMemberStatus(ymd);

    const memberStatuses: string[] = [];
    const seenStatuses = new Set<string>();
    const grid: Record<string, Record<string, number>> = {};

    for (const row of result) {
      const ms = row.memberStatus;
      const sheetStatus = row.sheetStatus;
      const count = row.workerCount;
      if (!seenStatuses.has(ms)) {
        seenStatuses.add(ms);
        memberStatuses.push(ms);
      }
      if (!grid[ms]) grid[ms] = {};
      grid[ms][sheetStatus] = count;
    }

    return { memberStatuses, grid };
  },
};
