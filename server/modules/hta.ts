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
      const { mode, workerId } = req.body || {};
      if (mode && mode !== "test" && mode !== "live") {
        res.status(400).json({ message: "Mode must be 'test' or 'live'" });
        return;
      }
      const result = await runInactivityScan({
        mode: mode === "live" ? "live" : "test",
        workerId: workerId || undefined,
      });
      res.json(result);
    } catch (error) {
      console.error("Failed to run inactivity scan:", error);
      res.status(500).json({ message: "Failed to run inactivity scan" });
    }
  });
}
