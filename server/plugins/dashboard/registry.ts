import type { Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { getEffectiveUser } from "../../modules/masquerade";
import { validateAgainstSchema } from "../../lib/json-schema-validator";
import type { JsonSchema } from "@shared/json-schema-form";
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

  variableName(pluginId: string): string {
    return `dashboard_plugin_${pluginId}_settings`;
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

  async getSettingsValue(plugin: DashboardPlugin): Promise<any> {
    const variable = await storage.variables.getByName(this.variableName(plugin.id));
    if (variable) return variable.value;
    return plugin.defaultSettings ?? {};
  }

  async saveSettings(plugin: DashboardPlugin, value: any): Promise<void> {
    const name = this.variableName(plugin.id);
    const existing = await storage.variables.getByName(name);
    if (existing) {
      await storage.variables.update(existing.id, { value });
    } else {
      await storage.variables.create({ name, value });
    }
  }

  async runLegacyMigrations(): Promise<void> {
    for (const plugin of this.list()) {
      if (!plugin.migrateLegacySettings) continue;
      try {
        const existing = await storage.variables.getByName(this.variableName(plugin.id));
        if (existing) continue;
        const migrated = await plugin.migrateLegacySettings();
        if (migrated && typeof migrated === "object" && Object.keys(migrated).length > 0) {
          await storage.variables.create({ name: this.variableName(plugin.id), value: migrated });
          logger.info(`Migrated legacy settings for dashboard plugin ${plugin.id}`, { service: SERVICE });
        }
      } catch (error) {
        logger.error(`Failed to migrate legacy settings for dashboard plugin ${plugin.id}`, {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
