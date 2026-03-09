import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "./components";
import { runInactivityScan } from "../services/hta-inactivity-scan";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerHtaRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const componentMiddleware = requireComponent("sitespecific.hta");

  app.post("/api/sitespecific/hta/inactivity-scan", requireAuth, componentMiddleware, requirePermission("staff"), async (req, res) => {
    try {
      const result = await runInactivityScan();
      res.json(result);
    } catch (error) {
      console.error("Failed to run inactivity scan:", error);
      res.status(500).json({ message: "Failed to run inactivity scan" });
    }
  });
}
