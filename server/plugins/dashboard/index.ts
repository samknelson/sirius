import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { dashboardPluginRegistry } from "./registry";
import { migrateWelcomeMessages } from "./plugins/welcome-messages";
import { migrateReportsSettings } from "./plugins/reports";

export { dashboardPluginRegistry, registerDashboardPlugin } from "./registry";
export type * from "./types";

let kindRegistered = false;
function registerDashboardKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "dashboard",
    registry: dashboardPluginRegistry,
    label: "Dashboard Widgets",
    description:
      "Widgets available on the dashboard, including which users can see them.",
    sortEntries: (a, b) =>
      a.order - b.order || a.id.localeCompare(b.id),
    // Resolve the manifest's `enabled` flag and the settings form schema from
    // the unified `plugin_configs` store. Under the multi-config model a plugin
    // may have several rows; the canonical one is the first by (ordering, id).
    // `configSchema` / `uiSchema` are attached so the generic plugin-config
    // admin UI can render the settings form for a dashboard config row.
    decorateEntries: async (entries) => {
      const { storage } = await import("../../storage");
      const configs = await storage.pluginConfigs.getByKind("dashboard");
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
  // Every dashboard config targets one or more roles (its sole relational
  // dimension). The roles array lives in the `plugin_configs_dashboard`
  // subsidiary and is surfaced as a required, filterable multi-select envelope
  // field — a viewer sees a widget when they hold ANY of its roles. There is
  // no "show everyone": no role match means the widget is hidden, and an
  // empty roles array is rejected on save.
  registerPluginConfigAdapter({
    pluginKind: "dashboard",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      roles: z.array(z.string().min(1)).min(1),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      // Admin filter: configs whose roles array contains this role. The
      // envelope field is named `roles`, so the generic filter bar sends
      // `roles=<roleId>`; map it onto the storage `role` contains-filter.
      roles: z.string().optional(),
      role: z.string().optional(),
      roleIn: z.array(z.string()).optional(),
    }).transform(({ roles, ...rest }) => ({
      ...rest,
      ...(roles !== undefined ? { role: roles } : {}),
    })),
    toRows: (input) => ({
      base: {
        pluginKind: "dashboard",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        roles: input.roles,
      },
    }),
    envelopeFields: [
      {
        name: "roles",
        label: "Visible to roles",
        type: "string",
        required: true,
        filterable: true,
        multiple: true,
        // `roles` stores role ids; render as a multi-select populated from the
        // roles lookup so the column and filter show readable role names.
        options: {
          endpoint: "/api/admin/roles",
          valueKey: "id",
          labelKey: "name",
        },
      },
    ],
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
  // Split any old per-role welcome-message content (consolidated config rows
  // and/or legacy `welcome_message_<roleId>` variables) into the unified
  // one-message-per-configuration shape, then retire the legacy variables.
  // Runs before seeding so a converted plugin isn't also given an empty seed.
  await migrateWelcomeMessages();
  // Ensure every renderable plugin has at least one config row so the
  // per-config dashboard render path never drops a previously-shown widget.
  await dashboardPluginRegistry.seedDefaultConfigs();
  // Every dashboard config MUST have a roles subsidiary row (the render/search
  // path inner-joins it). Run this LAST so newly-seeded and newly-migrated
  // configs all get roles: welcome configs adopt ALL still-valid legacy
  // data.roles; everything else defaults to the first role in the roles
  // table. Idempotent.
  await dashboardPluginRegistry.backfillRoleSubsidiaries();
  // Normalize legacy per-role reports settings into the flat `{ reports }`
  // shape. Runs AFTER the role backfill so every row has its envelope role
  // available to pick the right legacy list.
  await migrateReportsSettings();
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
