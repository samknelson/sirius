import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseStorage } from "../storage";
import { requireAccess } from "../accessControl";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerSessionRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  storage: DatabaseStorage
) {
  app.get("/api/sessions", requireAccess('admin'), async (req, res) => {
    try {
      const sessions = await storage.sessions.getSessions();
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.delete("/api/sessions/:sid", requireAccess('admin'), async (req, res) => {
    try {
      const { sid } = req.params;
      const deleted = await storage.sessions.deleteSession(sid);
      
      if (!deleted) {
        return res.status(404).json({ message: "Session not found" });
      }
      
      res.json({ success: true, message: "Session deleted" });
    } catch (error) {
      console.error("Error deleting session:", error);
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  app.get("/api/sessions/active-stats", requireAccess('admin'), async (req, res) => {
    try {
      const stats = await storage.sessions.getActiveUsersStats(4);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching active user stats:", error);
      res.status(500).json({ message: "Failed to fetch active user stats" });
    }
  });
}
