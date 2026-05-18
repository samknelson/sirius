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
  // NOTE: The dashboard manifest endpoint was unified in Task #208 and
  // now lives at `GET /api/plugins/dashboard/manifest` (see
  // `server/modules/plugins-manifest.ts`). The four legacy plugin
  // manifest endpoints — dashboard, dispatch eligibility, charge,
  // trust eligibility — were removed in the same task; all callers
  // were ported to the unified URL.

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

  // Single registry-backed content handler. Component + access-policy
  // gating is enforced inside dashboardPluginRegistry.runContent via the
  // shared `enforcePluginGating` helper.
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
