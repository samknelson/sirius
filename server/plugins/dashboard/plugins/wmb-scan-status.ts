import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";

export const wmbScanStatusPlugin: DashboardPlugin = {
  id: "wmb-scan-status",
  name: "Benefits Scan Status",
  description:
    "Display running and upcoming monthly benefits scans with links to details",
  requiredComponent: "trust.benefits.scan",
  requiredPolicy: "admin",

  async content(ctx) {
    const statuses = await ctx.storage.wmbScanQueue.getAllMonthStatuses();
    return { statuses };
  },

  client: {
    component: "wmb-scan-status:WmbScanStatus",
    order: 5,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(wmbScanStatusPlugin);
