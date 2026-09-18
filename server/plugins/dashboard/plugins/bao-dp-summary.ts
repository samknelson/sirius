import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { calculateDpCurrentMonthReport } from "../../../services/sitespecific/bao/dp-reporting";

export const baoDpSummaryPlugin: DashboardPlugin = {
  id: "bao-dp-summary",
  name: "Domestic Partner",
  description: "Live Domestic Partner coverage, charges, payments, and balances.",
  requiredComponent: "sitespecific.bao",
  requiredPolicy: "staff",
  content: {
    "": async () => {
      const report = await calculateDpCurrentMonthReport();
      const { rows: _rows, ...summary } = report;
      return summary;
    },
  },
  client: {
    component: "bao-dp-summary:BaoDpSummary",
    order: 8,
    requiredPermissions: ["staff", "admin"],
  },
};

registerDashboardPlugin(baoDpSummaryPlugin);