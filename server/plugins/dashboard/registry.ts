import type { Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { getEffectiveUser } from "../../modules/masquerade";
import { validateAgainstSchema } from "../../lib/json-schema-validator";
import type { JsonSchema } from "@shared/json-schema-form";
import type { PluginConfig } from "@shared/schema";
import { PluginRegistry, enforcePluginGating } from "../_core";
import type { BasePluginMetadata } from "../_core";
import type {
  DashboardPlugin,
  DashboardContentContext,
  DashboardContentResolver,
  DashboardPluginUiSchema,
} from "./types";

const SERVICE = "dashboard-plugin-registry";

/**
 * Manifest entry shape for dashboard plugins. Matches the legacy
 * `/api/dashboard-plugins/manifest` response shape so the dashboard /
 * config UIs need no payload changes — only the URL changes.
 */
export interface DashboardManifestEntry {
  id: string;
  name: string;
  description: string;
  componentId: string;
  componentProps: Record<string, unknown> | null;
  order: number;
  fullWidth: boolean;
  requiredPermissions: string[];
  requiredPolicy?: string;
  requiredComponent?: string;
  hasSettings: boolean;
  enabledByDefault: boolean;
  enabled: boolean;
  hidden?: boolean;
  /**
   * Resolved JSON Schema for the plugin's settings, populated in
   * `decorateEntries`. The generic plugin-config admin UI reads this to
   * render the settings form for a dashboard config row.
   */
  configSchema?: JsonSchema;
  /** Resolved RJSF uiSchema companion to `configSchema`. */
  uiSchema?: DashboardPluginUiSchema;
}

function pluginToMetadata(p: DashboardPlugin): BasePluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: !p.client, // headless plugins never appear on the manifest
  };
}

function pluginToManifestEntry(p: DashboardPlugin): DashboardManifestEntry {
  const client = p.client;
  if (!client) {
    // Headless plugins are filtered out by `hidden: true` from
    // pluginToMetadata, but TS still needs a value. Return a stub.
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      componentId: "",
      componentProps: null,
      order: 0,
      fullWidth: false,
      requiredPermissions: [],
      requiredPolicy: p.requiredPolicy,
      requiredComponent: p.requiredComponent,
      hasSettings: !!p.settingsSchema,
      enabledByDefault: false,
      enabled: false,
      hidden: true,
    };
  }
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    componentId: client.component,
    componentProps: client.componentProps ?? null,
    order: client.order,
    fullWidth: client.fullWidth === true,
    requiredPermissions: client.requiredPermissions ?? [],
    requiredPolicy: p.requiredPolicy,
    requiredComponent: p.requiredComponent,
    hasSettings: !!p.settingsSchema,
    enabledByDefault: client.enabledByDefault !== false,
    enabled: client.enabledByDefault !== false, // overridden in decorateEntries
  };
}

class DashboardPluginRegistry extends PluginRegistry<DashboardPlugin, DashboardManifestEntry> {
  constructor() {
    super({
      kind: "dashboard",
      getMetadata: pluginToMetadata,
      toManifestEntry: pluginToManifestEntry,
      allowOverwrite: true,
    });
  }

  // Backwards-compatible aliases for legacy call sites.
  getAll(): DashboardPlugin[] {
    return this.list();
  }

  async resolveSchema(plugin: DashboardPlugin): Promise<JsonSchema | undefined> {
    if (!plugin.settingsSchema) return undefined;
    return typeof plugin.settingsSchema === "function"
      ? await plugin.settingsSchema()
      : plugin.settingsSchema;
  }

  async resolveUiSchema(plugin: DashboardPlugin): Promise<DashboardPluginUiSchema | undefined> {
    if (!plugin.uiSchema) return undefined;
    return typeof plugin.uiSchema === "function" ? await plugin.uiSchema() : plugin.uiSchema;
  }

  /**
   * The canonical config row for a plugin: the first by `(ordering, id)`.
   * Under the unified multi-config model an operator may create several rows
   * for one dashboard plugin; the runtime resolves to a single deterministic
   * one. Returns undefined when the plugin has no config row at all.
   */
  async getCanonicalConfig(plugin: DashboardPlugin): Promise<PluginConfig | undefined> {
    const rows = await storage.pluginConfigs.getByTypeAndPlugin("dashboard", plugin.id);
    return rows[0];
  }

  /** Enabled state to assume when a plugin has no explicit config row. */
  defaultEnabled(plugin: DashboardPlugin): boolean {
    return plugin.client ? plugin.client.enabledByDefault !== false : false;
  }

  async getSettingsValue(plugin: DashboardPlugin): Promise<any> {
    const row = await this.getCanonicalConfig(plugin);
    if (row) return row.data ?? {};
    return plugin.defaultSettings ?? {};
  }

  /**
   * One-shot, idempotent backfill from the legacy `variables` store
   * (`dashboard_plugin_<id>` enabled flag + `dashboard_plugin_<id>_settings`
   * JSON) into unified `plugin_configs` rows, then retirement of the old keys.
   *
   * Runs at boot. For each registered plugin without a config row it creates
   * one from whatever legacy state exists (or, absent any, from
   * `migrateLegacySettings`), with `enabled` defaulting to the plugin's
   * enabledByDefault when no toggle was ever stored — preserving the
   * pre-migration runtime behavior. After backfilling it deletes every
   * `dashboard_plugin_*` variable for handled plugins plus any orphans
   * (variables for plugins no longer registered). Re-running is a no-op.
   */
  async backfillFromLegacyVariables(): Promise<void> {
    const plugins = this.list();
    const handled = new Set<string>();
    for (const plugin of plugins) {
      try {
        const existing = await storage.pluginConfigs.getByTypeAndPlugin("dashboard", plugin.id);
        if (existing.length > 0) {
          handled.add(plugin.id);
          continue;
        }
        const enabledVar = await storage.variables.getByName(`dashboard_plugin_${plugin.id}`);
        const settingsVar = await storage.variables.getByName(
          `dashboard_plugin_${plugin.id}_settings`,
        );
        let data: unknown = settingsVar ? settingsVar.value : undefined;
        const hasLegacy = !!enabledVar || !!settingsVar;
        if (!hasLegacy && plugin.migrateLegacySettings) {
          const migrated = await plugin.migrateLegacySettings();
          if (migrated && typeof migrated === "object" && Object.keys(migrated).length > 0) {
            data = migrated;
          }
        }
        if (data !== undefined || enabledVar) {
          const enabled = enabledVar ? Boolean(enabledVar.value) : this.defaultEnabled(plugin);
          await storage.pluginConfigs.create({
            pluginType: "dashboard",
            pluginId: plugin.id,
            enabled,
            name: null,
            ordering: 0,
            data: data ?? {},
          });
          logger.info(`Backfilled dashboard plugin config for ${plugin.id}`, { service: SERVICE });
        }
        handled.add(plugin.id);
      } catch (error) {
        logger.error(`Failed to backfill dashboard plugin config for ${plugin.id}`, {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Retire legacy keys for handled plugins + orphans (unregistered plugins).
    try {
      const all = await storage.variables.getAll();
      const known = new Set(plugins.map((p) => p.id));
      for (const v of all) {
        if (!v.name.startsWith("dashboard_plugin_")) continue;
        const pid = v.name.replace(/^dashboard_plugin_/, "").replace(/_settings$/, "");
        if (handled.has(pid) || !known.has(pid)) {
          await storage.variables.delete(v.id);
        }
      }
    } catch (error) {
      logger.error("Failed to retire legacy dashboard plugin variables", {
        service: SERVICE,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Dashboard `/content` front-door. Authoritative enforcement point for
   * component + access-policy gating, expressed via the shared helpers
   * in `server/plugins/_core/gating.ts`.
   */
  async runContent(
    plugin: DashboardPlugin,
    action: string | undefined,
    req: Request,
    res: Response,
  ): Promise<void> {
    if (!plugin.content) {
      res.status(404).json({ message: `Plugin '${plugin.id}' has no content resolver` });
      return;
    }

    let resolver: DashboardContentResolver | undefined;
    if (typeof plugin.content === "function") {
      if (action) {
        res.status(404).json({ message: `Plugin '${plugin.id}' does not support action '${action}'` });
        return;
      }
      resolver = plugin.content;
    } else {
      const key = action ?? "";
      resolver = plugin.content[key];
      if (!resolver) {
        res.status(404).json({
          message: action
            ? `Plugin '${plugin.id}' has no action '${action}'`
            : `Plugin '${plugin.id}' requires an action`,
        });
        return;
      }
    }

    const gating = await enforcePluginGating(pluginToMetadata(plugin), req);
    if (!gating.ok) {
      res.status(gating.status).json({ message: gating.message });
      return;
    }

    const user = (req as any).user;
    const session = (req as any).session;
    const { dbUser } = await getEffectiveUser(session, user);
    if (!dbUser) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    const userRoles = await storage.users.getUserRoles(dbUser.id);
    const settings = await this.getSettingsValue(plugin);

    const ctx: DashboardContentContext = {
      userId: dbUser.id,
      dbUser,
      userRoles: userRoles.map((r) => ({ id: r.id, name: r.name })),
      query: req.query as Record<string, unknown>,
      settings,
      req,
      storage,
    };

    const content = await resolver(ctx);
    res.json(content);
  }

  async validateSettings(
    plugin: DashboardPlugin,
    payload: unknown,
  ): Promise<{ valid: true } | { valid: false; errors: string[] }> {
    const schema = await this.resolveSchema(plugin);
    if (!schema) return { valid: true };
    const result = validateAgainstSchema(schema, payload);
    if (result.valid) return { valid: true };
    return { valid: false, errors: result.errors ?? ["Invalid settings"] };
  }
}

export const dashboardPluginRegistry = new DashboardPluginRegistry();

/**
 * Convenience helper used by individual plugin files to self-register
 * at module top level. Mirrors `registerChargePlugin` / `registerEligibilityPlugin`.
 */
export function registerDashboardPlugin(plugin: DashboardPlugin): void {
  dashboardPluginRegistry.register(plugin);
}
