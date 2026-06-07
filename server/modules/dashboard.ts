import type { Express, Request, Response, NextFunction } from "express";
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
  // now lives at `GET /api/plugins/dashboard/manifest`. The per-plugin
  // settings endpoints were unified in Task #209 and now live at:
  //   GET  /api/plugins/dashboard/:id/settings
  //   PUT  /api/plugins/dashboard/:id/settings
  // See `server/modules/plugins-admin.ts`. Per-config enable/disable
  // state now lives on each `plugin_configs` row and is managed through
  // the unified `/api/plugins/dashboard/configs` endpoints; the
  // dashboard manifest's `decorateEntries` reads `enabled` from there.

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

  // One entry per dashboard config row (joined with plugin display metadata).
  // The dashboard renders one widget per item, so a plugin configured several
  // times yields several items. Per-user gating metadata travels with each
  // item; the client filters and each widget's /content read remains the
  // authoritative enforcement point.
  app.get("/api/dashboard-plugins/items", requireAuth, async (_req: Request, res: Response) => {
    try {
      const items = await dashboardPluginRegistry.getConfigItems();
      res.setHeader("Cache-Control", "no-store");
      res.json(items);
    } catch (error) {
      console.error("Failed to fetch dashboard items:", error);
      res.status(500).json({ message: "Failed to fetch dashboard items" });
    }
  });

  app.get("/api/dashboard-plugins/:pluginId/content", requireAuth, contentHandler);
  app.get("/api/dashboard-plugins/:pluginId/content/:action", requireAuth, contentHandler);
}
