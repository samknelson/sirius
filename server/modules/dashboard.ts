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
  // enable toggle + settings endpoints were unified in Task #209 and
  // now live at:
  //   GET  /api/plugins/dashboard/enabled
  //   PUT  /api/plugins/dashboard/:id/enabled
  //   GET  /api/plugins/dashboard/:id/settings
  //   PUT  /api/plugins/dashboard/:id/settings
  // See `server/modules/plugins-admin.ts`.

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
