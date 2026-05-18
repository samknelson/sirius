import { logger } from "../../logger";
import { dashboardPluginRegistry } from "./registry";
import { welcomeMessagesPlugin } from "./plugins/welcome-messages";
import { bookmarksPlugin } from "./plugins/bookmarks";
import { reportsPlugin } from "./plugins/reports";
import { employerMonthlyUploadsPlugin } from "./plugins/employer-monthly-uploads";
import { wmbScanStatusPlugin } from "./plugins/wmb-scan-status";
import { activeSessionsPlugin } from "./plugins/active-sessions";
import { myStewardPlugin } from "./plugins/my-steward";
import { btuDuesStatusPlugin } from "./plugins/btu-dues-status";
import { btuBuSummaryPlugin } from "./plugins/btu-bu-summary";
import { edlsSummaryPlugin } from "./plugins/edls-summary";
import { myShopsPlugin } from "./plugins/my-shops";

export { dashboardPluginRegistry } from "./registry";
export type * from "./types";

export function registerDashboardPlugins(): void {
  dashboardPluginRegistry.register(welcomeMessagesPlugin);
  dashboardPluginRegistry.register(bookmarksPlugin);
  dashboardPluginRegistry.register(reportsPlugin);
  dashboardPluginRegistry.register(employerMonthlyUploadsPlugin);
  dashboardPluginRegistry.register(wmbScanStatusPlugin);
  dashboardPluginRegistry.register(activeSessionsPlugin);
  dashboardPluginRegistry.register(myStewardPlugin);
  dashboardPluginRegistry.register(btuDuesStatusPlugin);
  dashboardPluginRegistry.register(btuBuSummaryPlugin);
  dashboardPluginRegistry.register(edlsSummaryPlugin);
  dashboardPluginRegistry.register(myShopsPlugin);
  logger.info("Dashboard plugins registered", {
    service: "dashboard-plugins",
    plugins: dashboardPluginRegistry.getAll().map((p) => p.id),
  });
}

export async function initializeDashboardPluginSystem(): Promise<void> {
  registerDashboardPlugins();
  await dashboardPluginRegistry.runLegacyMigrations();
}
