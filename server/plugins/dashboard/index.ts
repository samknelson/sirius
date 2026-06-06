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
    // Resolve the manifest's `enabled` flag and the settings form schema from
    // the unified `plugin_configs` store. Under the multi-config model a plugin
    // may have several rows; the canonical one is the first by (ordering, id).
    // `configSchema` / `uiSchema` are attached so the generic plugin-config
    // admin UI can render the settings form for a dashboard config row.
    decorateEntries: async (entries) => {
      const { storage } = await import("../../storage");
      const configs = await storage.pluginConfigs.getByType("dashboard");
      const firstByPlugin = new Map<string, (typeof configs)[number]>();
      for (const c of configs) {
        const cur = firstByPlugin.get(c.pluginId);
        if (
          !cur ||
          c.ordering < cur.ordering ||
          (c.ordering === cur.ordering && c.id < cur.id)
        ) {
          firstByPlugin.set(c.pluginId, c);
        }
      }
      return Promise.all(
        entries.map(async (entry) => {
          const row = firstByPlugin.get(entry.id);
          const enabled = row ? row.enabled : entry.enabledByDefault;
          const plugin = dashboardPluginRegistry.get(entry.id);
          const configSchema = plugin
            ? await dashboardPluginRegistry.resolveSchema(plugin)
            : undefined;
          const uiSchema = plugin
            ? await dashboardPluginRegistry.resolveUiSchema(plugin)
            : undefined;
          return { ...entry, enabled, configSchema, uiSchema };
        }),
      );
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
  await dashboardPluginRegistry.backfillFromLegacyVariables();
  // Ensure every renderable plugin has at least one config row so the
  // per-config dashboard render path never drops a previously-shown widget.
  await dashboardPluginRegistry.seedDefaultConfigs();
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
