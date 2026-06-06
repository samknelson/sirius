import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { dashboardPluginRegistry } from "./registry";

export { dashboardPluginRegistry, registerDashboardPlugin } from "./registry";
export type * from "./types";

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
    // Validate a unified plugin_configs `data` payload against the dashboard
    // plugin's own JSON schema. Generic CRUD calls this so dashboard configs
    // are never stored with arbitrary, unvalidated settings.
    validateConfig: async (plugin, config) => {
      return dashboardPluginRegistry.validateSettings(plugin, config);
    },
  });
  // Dashboard configs carry no relational dimensions, so they live entirely
  // in the base table — the adapter declares no subsidiary.
  registerPluginConfigAdapter({
    pluginType: "dashboard",
    configSchema: z.object({ ...baseConfigSchemaShape }),
    searchParamsSchema: z.object({ ...baseSearchSchemaShape }),
    toRows: (input) => ({
      base: {
        pluginType: "dashboard",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
    }),
  });
  kindRegistered = true;
}

/**
 * Initialize the dashboard plugin system.
 *
 * Plugins self-register at module top level — the side-effect imports at
 * the bottom of this file load each plugin once and trigger its
 * `registerDashboardPlugin(...)` call. To add a new plugin: drop a file
 * under `./plugins/` and add one `import "./plugins/<name>"` line below.
 *
 * (This matches the convention used by every other plugin kind in the
 * repo — see `server/plugins/_core/README.md` → "Plugin registration
 * convention".)
 */
export async function initializeDashboardPluginSystem(): Promise<void> {
  registerDashboardKind();
  logger.info("Dashboard plugins registered", {
    service: "dashboard-plugins",
    plugins: dashboardPluginRegistry.getAll().map((p) => p.id),
  });
  await dashboardPluginRegistry.runLegacyMigrations();
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/welcome-messages";
import "./plugins/bookmarks";
import "./plugins/reports";
import "./plugins/employer-monthly-uploads";
import "./plugins/wmb-scan-status";
import "./plugins/active-sessions";
import "./plugins/my-steward";
import "./plugins/btu-dues-status";
import "./plugins/btu-bu-summary";
import "./plugins/edls-summary";
import "./plugins/my-shops";
