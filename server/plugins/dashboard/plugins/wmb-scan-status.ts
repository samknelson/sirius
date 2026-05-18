import type { DashboardPlugin } from "../types";

export const wmbScanStatusPlugin: DashboardPlugin = {
  id: "wmb-scan-status",
  name: "Benefits Scan Status",
  description:
    "Display running and upcoming monthly benefits scans with links to details",
  client: {
    component: "wmb-scan-status:WmbScanStatus",
    order: 5,
    requiredPermissions: ["admin"],
  },
};
