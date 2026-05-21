import type { Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { isComponentEnabled } from "../../modules/components";
import { checkAccessInline } from "../../services/access-policy-evaluator";
import { getEffectiveUser } from "../../modules/masquerade";
import { validateAgainstSchema } from "../../lib/json-schema-validator";
import type { JsonSchema } from "@shared/json-schema-form";
import type {
  DashboardPlugin,
  DashboardContentContext,
  DashboardContentResolver,
  DashboardPluginUiSchema,
} from "./types";

const SERVICE = "dashboard-plugin-registry";

class DashboardPluginRegistry {
  private plugins = new Map<string, DashboardPlugin>();

  register(plugin: DashboardPlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Dashboard plugin ${plugin.id} already registered, overwriting`, { service: SERVICE });
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(id: string): DashboardPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): DashboardPlugin[] {
    return Array.from(this.plugins.values());
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
    for (const plugin of this.plugins.values()) {
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

  async checkGating(
    plugin: DashboardPlugin,
    req: Request,
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    if (plugin.componentId) {
      const enabled = await isComponentEnabled(plugin.componentId);
      if (!enabled) {
        return { ok: false, status: 403, message: `Component '${plugin.componentId}' not enabled` };
      }
    }
    if (plugin.requiredPolicy) {
      const result = await checkAccessInline(req, plugin.requiredPolicy);
      if (!result.granted) {
        return { ok: false, status: 403, message: result.reason || "Access denied" };
      }
    }
    return { ok: true };
  }

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

    const gating = await this.checkGating(plugin, req);
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
