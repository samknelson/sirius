import type { Express, Request, Response, NextFunction } from "express";
import { dashboardPluginRegistry } from "../plugins/dashboard";
import {
  resolveDashboardTargetUser,
  checkTargetPluginGating,
} from "../plugins/dashboard/registry";
import { storage } from "../storage";
import { getEffectiveUser } from "./masquerade";
import { checkAccess } from "../services/access-policy-evaluator";

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
  // See `server/modules/system/plugins-admin.ts`. Per-config enable/disable
  // state now lives on each `plugin_configs` row and is managed through
  // the unified `/api/plugins/dashboard/configs` endpoints; the
  // dashboard manifest's `decorateEntries` reads `enabled` from there.

  // Single registry-backed content handler. Component + access-policy
  // gating is enforced inside dashboardPluginRegistry.runContent via the
  // shared `enforcePluginGating` helper (or, in staff target-view mode,
  // evaluated against the target user).
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
  //
  // Staff target-view: with `?targetUserId=` (staff-only), items resolve
  // against the TARGET user's roles and are pre-filtered server-side against
  // the target's permissions/policies/components — the gating fields are
  // returned stripped so the client renders exactly the server-approved set
  // instead of re-filtering with the VIEWER's auth context.
  app.get("/api/dashboard-plugins/items", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const session = (req as any).session;
      const { dbUser } = await getEffectiveUser(session, user);
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }

      const targetResult = await resolveDashboardTargetUser(req, dbUser);
      if (!targetResult.ok) {
        res.status(targetResult.status).json({ message: targetResult.message });
        return;
      }
      const target = targetResult.target;

      if (target) {
        const targetRoles = await storage.users.getUserRoles(target.id);
        const items = await dashboardPluginRegistry.getConfigItems(
          targetRoles.map((r) => r.id),
        );
        const filtered = [];
        for (const item of items) {
          // Same shared target-gating (component + policy + client
          // requiredPermissions) that the /content front-door enforces.
          const plugin = dashboardPluginRegistry.get(item.id);
          if (!plugin) continue;
          const gate = await checkTargetPluginGating(plugin, target);
          if (!gate.ok) continue;
          // Gating already evaluated against the target — strip the hint
          // fields so the client does not re-filter with the viewer's auth.
          filtered.push({
            ...item,
            requiredPermissions: [],
            requiredPolicy: undefined,
            requiredComponent: undefined,
          });
        }
        res.setHeader("Cache-Control", "no-store");
        res.json(filtered);
        return;
      }

      const userRoles = await storage.users.getUserRoles(dbUser.id);
      const items = await dashboardPluginRegistry.getConfigItems(
        userRoles.map((r) => r.id),
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(items);
    } catch (error) {
      console.error("Failed to fetch dashboard items:", error);
      res.status(500).json({ message: "Failed to fetch dashboard items" });
    }
  });

  // Minimal identity of a target user for the staff dashboard-view banner
  // ("Viewing dashboard of <user>"). Staff-only, and deliberately narrow:
  // id/name/email only — NOT the admin user detail payload.
  app.get(
    "/api/dashboard-plugins/target-user/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const session = (req as any).session;
        const { dbUser } = await getEffectiveUser(session, user);
        if (!dbUser) {
          res.status(401).json({ message: "User not found" });
          return;
        }
        const staff = await checkAccess("staff", dbUser);
        if (!staff.granted) {
          res
            .status(403)
            .json({ message: "Staff access required to view another user's dashboard" });
          return;
        }
        const target = await storage.users.getUser(req.params.id);
        if (!target) {
          res.status(404).json({ message: "Target user not found" });
          return;
        }
        res.json({
          id: target.id,
          email: target.email,
          firstName: target.firstName,
          lastName: target.lastName,
        });
      } catch (error) {
        console.error("Failed to fetch dashboard target user:", error);
        res.status(500).json({ message: "Failed to fetch dashboard target user" });
      }
    },
  );

  app.get("/api/dashboard-plugins/:pluginId/content", requireAuth, contentHandler);
  app.get("/api/dashboard-plugins/:pluginId/content/:action", requireAuth, contentHandler);
}
