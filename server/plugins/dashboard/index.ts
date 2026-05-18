import { logger } from "../../logger";
import { registerPluginKind } from "../_core";
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

let kindRegistered = false;
function registerDashboardKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "dashboard",
    registry: dashboardPluginRegistry,
    sortEntries: (a, b) =>
      a.order - b.order || a.id.localeCompare(b.id),
    // Per-plugin enable toggle lives in a `dashboard_plugin_<id>` variable
    // (independent of the schema-driven settings variable). Apply it here
    // so the manifest reflects the operator's current selection.
    decorateEntries: async (entries) => {
      const enriched = await Promise.all(
        entries.map(async (entry) => {
          const variable = await (
            await import("../../storage")
          ).storage.variables.getByName(`dashboard_plugin_${entry.id}`);
          const enabled =
            variable !== undefined && variable !== null
              ? Boolean(variable.value)
              : entry.enabledByDefault;
          return { ...entry, enabled };
        }),
      );
      return enriched;
    },
    // Per-plugin enable list / toggle. Backs
    // GET /api/plugins/dashboard/enabled and
    // PUT /api/plugins/dashboard/:id/enabled.
    listEnabled: async () => {
      const { storage } = await import("../../storage");
      const all = await storage.variables.getAll();
      return all
        .filter((v) => v.name.startsWith("dashboard_plugin_") && !v.name.endsWith("_settings"))
        .map((v) => ({
          pluginId: v.name.replace("dashboard_plugin_", ""),
          enabled: Boolean(v.value),
        }));
    },
    setEnabled: async (plugin, enabled) => {
      const { storage } = await import("../../storage");
      const name = `dashboard_plugin_${plugin.id}`;
      const existing = await storage.variables.getByName(name);
      if (existing) {
        await storage.variables.update(existing.id, { value: enabled });
      } else {
        await storage.variables.create({ name, value: enabled });
      }
    },
    // Schema-driven settings for the per-plugin settings page. Backs
    // GET / PUT /api/plugins/dashboard/:id/settings.
    getSettings: async (plugin) => {
      const schema = await dashboardPluginRegistry.resolveSchema(plugin);
      if (!schema) return null;
      const uiSchema = (await dashboardPluginRegistry.resolveUiSchema(plugin)) ?? {};
      const value = await dashboardPluginRegistry.getSettingsValue(plugin);
      return { schema, uiSchema, value };
    },
    saveSettings: async (plugin, value) => {
      const result = await dashboardPluginRegistry.validateSettings(plugin, value);
      if (!result.valid) {
        return { valid: false, errors: result.errors };
      }
      await dashboardPluginRegistry.saveSettings(plugin, value);
      return { valid: true };
    },
  });
  kindRegistered = true;
}

export async function initializeDashboardPluginSystem(): Promise<void> {
  registerDashboardPlugins();
  registerDashboardKind();
  await dashboardPluginRegistry.runLegacyMigrations();
}
