import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseStorage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { resolveFloodIdentifierNames } from "../../flood/service";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/** Operational history only. Configuration uses generic flood Plugin Configs. */
export function registerFloodEventRoutes(app: Express, _requireAuth: AuthMiddleware, storage: DatabaseStorage) {
  app.get("/api/flood-events", requireAccess("admin"), async (req, res) => {
    try {
      const events = await storage.flood.listFloodEvents(req.query.event as string | undefined);
      const names = await resolveFloodIdentifierNames(events);
      res.json(events.map(event => ({
        ...event, identifierName: names.get(`${event.pluginConfigurationId}:${event.identifier}`) || null,
      })));
    } catch (error) {
      console.error("Error fetching flood events:", error);
      res.status(500).json({ message: "Failed to fetch flood events" });
    }
  });
  app.get("/api/flood-events/types", requireAccess("admin"), async (_req, res) => {
    try { res.json(await storage.flood.getDistinctEventTypes()); }
    catch (error) {
      console.error("Error fetching flood event types:", error);
      res.status(500).json({ message: "Failed to fetch flood event types" });
    }
  });
  app.delete("/api/flood-events/:id", requireAccess("admin"), async (req, res) => {
    try {
      await storage.flood.deleteFloodEvent(req.params.id);
      res.json({ success: true, message: "Flood event deleted" });
    } catch (error) {
      console.error("Error deleting flood event:", error);
      res.status(500).json({ message: "Failed to delete flood event" });
    }
  });
  app.delete("/api/flood-events", requireAccess("admin"), async (req, res) => {
    try {
      const eventType = req.query.event as string | undefined;
      const deletedCount = eventType
        ? await storage.flood.deleteFloodEventsByType(eventType)
        : await storage.flood.deleteAllFloodEvents();
      res.json({ success: true, deletedCount, message: `Deleted ${deletedCount} flood events` });
    } catch (error) {
      console.error("Error deleting flood events:", error);
      res.status(500).json({ message: "Failed to delete flood events" });
    }
  });
}
