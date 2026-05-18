import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { dashboardPluginRegistry } from "../plugins/dashboard";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerDashboardRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
) {
  // Plugin manifest for the dashboard / config UIs. Returns the declarative
  // metadata for every plugin that has a `client` block. Gating is *not*
  // evaluated here — the client filters on requiredPermissions / requiredPolicy
  // / requiredComponent as UI hints, and /content remains the authoritative
  // enforcement point (mirrors Task #195's wizard framework stance).
  app.get("/api/dashboard-plugins/manifest", requireAuth, async (_req, res) => {
    try {
      const allVariables = await storage.variables.getAll();
      const enabledByVar = new Map<string, boolean>();
      for (const v of allVariables) {
        if (v.name.startsWith("dashboard_plugin_") && !v.name.endsWith("_settings")) {
          enabledByVar.set(v.name.replace("dashboard_plugin_", ""), v.value as boolean);
        }
      }

      const entries = dashboardPluginRegistry
        .getAll()
        .filter((p) => !!p.client)
        .map((p) => {
          const client = p.client!;
          const variableValue = enabledByVar.get(p.id);
          const enabled =
            variableValue !== undefined
              ? variableValue
              : client.enabledByDefault !== false;
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
            requiredComponent: p.componentId,
            hasSettings: !!p.settingsSchema,
            enabledByDefault: client.enabledByDefault !== false,
            enabled,
          };
        })
        .sort((a, b) => a.order - b.order);

      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin manifest" });
    }
  });

  // List enabled flags for all plugin configs (per-plugin enable/disable toggle).
  app.get("/api/dashboard-plugins/config", requireAuth, async (_req, res) => {
    try {
      const allVariables = await storage.variables.getAll();
      const pluginConfigs = allVariables
        .filter((v) => v.name.startsWith("dashboard_plugin_") && !v.name.endsWith("_settings"))
        .map((v) => ({
          pluginId: v.name.replace("dashboard_plugin_", ""),
          enabled: v.value as boolean,
        }));
      res.json(pluginConfigs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin configurations" });
    }
  });

  // Toggle a plugin's enabled flag (admin).
  app.put("/api/dashboard-plugins/config/:pluginId", requireAccess("admin"), async (req, res) => {
    try {
      const { pluginId } = req.params;
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        res.status(400).json({ message: "Invalid enabled value" });
        return;
      }
      const variableName = `dashboard_plugin_${pluginId}`;
      const existing = await storage.variables.getByName(variableName);
      if (existing) {
        await storage.variables.update(existing.id, { value: enabled });
      } else {
        await storage.variables.create({ name: variableName, value: enabled });
      }
      res.json({ pluginId, enabled });
    } catch (error) {
      res.status(500).json({ message: "Failed to update plugin configuration" });
    }
  });

  // GET /api/dashboard-plugins/:pluginId/settings - Returns { schema, uiSchema, value }
  // for the generic settings UI.
  app.get("/api/dashboard-plugins/:pluginId/settings", requireAccess("admin"), async (req, res) => {
    try {
      const plugin = dashboardPluginRegistry.get(req.params.pluginId);
      if (!plugin) {
        res.status(404).json({ message: "Plugin not found" });
        return;
      }
      const schema = await dashboardPluginRegistry.resolveSchema(plugin);
      if (!schema) {
        res.status(404).json({ message: "Plugin has no settings schema" });
        return;
      }
      const uiSchema = (await dashboardPluginRegistry.resolveUiSchema(plugin)) ?? {};
      const value = await dashboardPluginRegistry.getSettingsValue(plugin);
      res.json({ schema, uiSchema, value });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin settings" });
    }
  });

  // PUT /api/dashboard-plugins/:pluginId/settings - Validate via the plugin's JSON Schema
  // (AJV) and persist.
  app.put("/api/dashboard-plugins/:pluginId/settings", requireAccess("admin"), async (req, res) => {
    try {
      const plugin = dashboardPluginRegistry.get(req.params.pluginId);
      if (!plugin) {
        res.status(404).json({ message: "Plugin not found" });
        return;
      }
      const result = await dashboardPluginRegistry.validateSettings(plugin, req.body);
      if (!result.valid) {
        res.status(400).json({ message: "Invalid settings format", errors: result.errors });
        return;
      }
      await dashboardPluginRegistry.saveSettings(plugin, req.body);
      res.json({ success: true, settings: req.body });
    } catch (error) {
      res.status(500).json({ message: "Failed to update plugin settings" });
    }
  });

  // Single registry-backed content handler. Serves both /content (no action) and
  // /content/:action by deferring to dashboardPluginRegistry.runContent. Component
  // and access-policy gating live on the plugin manifest itself.
  const contentHandler = async (req: Request, res: Response) => {
    try {
      const plugin = dashboardPluginRegistry.get(req.params.pluginId);
      if (!plugin) {
        res.status(404).json({ message: `Plugin '${req.params.pluginId}' not found` });
        return;
      }
      await dashboardPluginRegistry.runContent(plugin, req.params.action, req, res);
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error
          ? Number((error as any).status) || 500
          : 500;
      const message =
        error instanceof Error ? error.message : "Failed to fetch plugin content";
      if (status >= 500) {
        console.error("Error fetching plugin content:", error);
      }
      res.status(status).json({ message });
    }
  };

  app.get("/api/dashboard-plugins/:pluginId/content", requireAuth, contentHandler);
  app.get("/api/dashboard-plugins/:pluginId/content/:action", requireAuth, contentHandler);
}
