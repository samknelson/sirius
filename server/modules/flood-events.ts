import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseStorage } from "../storage";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerFloodEventRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  storage: DatabaseStorage
) {
  app.get("/api/flood-events", requireAccess(policies.admin), async (req, res) => {
    try {
      const eventType = req.query.event as string | undefined;
      const events = await storage.flood.listFloodEvents(eventType);
      res.json(events);
    } catch (error) {
      console.error("Error fetching flood events:", error);
      res.status(500).json({ message: "Failed to fetch flood events" });
    }
  });

  app.get("/api/flood-events/types", requireAccess(policies.admin), async (req, res) => {
    try {
      const types = await storage.flood.getDistinctEventTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching flood event types:", error);
      res.status(500).json({ message: "Failed to fetch flood event types" });
    }
  });

  app.delete("/api/flood-events/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.flood.deleteFloodEvent(id);
      res.json({ success: true, message: "Flood event deleted" });
    } catch (error) {
      console.error("Error deleting flood event:", error);
      res.status(500).json({ message: "Failed to delete flood event" });
    }
  });

  app.delete("/api/flood-events", requireAccess(policies.admin), async (req, res) => {
    try {
      const eventType = req.query.event as string | undefined;
      
      let deletedCount: number;
      if (eventType) {
        deletedCount = await storage.flood.deleteFloodEventsByType(eventType);
      } else {
        deletedCount = await storage.flood.deleteAllFloodEvents();
      }
      
      res.json({ success: true, deletedCount, message: `Deleted ${deletedCount} flood events` });
    } catch (error) {
      console.error("Error deleting flood events:", error);
      res.status(500).json({ message: "Failed to delete flood events" });
    }
  });
}
