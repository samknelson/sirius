import type { Express, Request, Response, NextFunction } from "express";
import type { DatabaseStorage } from "../storage";
import { requireAccess } from "../accessControl";
import { floodEventRegistry } from "../flood/registry";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerFloodEventRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  storage: DatabaseStorage
) {
  app.get("/api/flood-events", requireAccess('admin'), async (req, res) => {
    try {
      const eventType = req.query.event as string | undefined;
      const events = await storage.flood.listFloodEvents(eventType);
      
      const nameMap = await floodEventRegistry.resolveIdentifierNames(
        events.map(e => ({ event: e.event, identifier: e.identifier }))
      );
      
      const eventsWithNames = events.map(e => ({
        ...e,
        identifierName: nameMap.get(`${e.event}:${e.identifier}`) || null,
      }));
      
      res.json(eventsWithNames);
    } catch (error) {
      console.error("Error fetching flood events:", error);
      res.status(500).json({ message: "Failed to fetch flood events" });
    }
  });

  app.get("/api/flood-events/types", requireAccess('admin'), async (req, res) => {
    try {
      const types = await storage.flood.getDistinctEventTypes();
      res.json(types);
    } catch (error) {
      console.error("Error fetching flood event types:", error);
      res.status(500).json({ message: "Failed to fetch flood event types" });
    }
  });

  app.delete("/api/flood-events/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.flood.deleteFloodEvent(id);
      res.json({ success: true, message: "Flood event deleted" });
    } catch (error) {
      console.error("Error deleting flood event:", error);
      res.status(500).json({ message: "Failed to delete flood event" });
    }
  });

  app.delete("/api/flood-events", requireAccess('admin'), async (req, res) => {
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

  app.get("/api/flood-config/definitions", requireAccess('admin'), async (req, res) => {
    try {
      const definitions = floodEventRegistry.getAllDefinitions();
      
      const configuredDefinitions = await Promise.all(
        definitions.map(async (def) => {
          const variableName = `flood_${def.name}`;
          const variable = await storage.variables.getByName(variableName);
          
          if (variable?.value) {
            try {
              const config = typeof variable.value === 'string' 
                ? JSON.parse(variable.value) 
                : variable.value;
              return {
                name: def.name,
                threshold: config.threshold ?? def.threshold,
                windowSeconds: config.windowSeconds ?? def.windowSeconds,
                isCustom: true,
                variableId: variable.id,
              };
            } catch {
              return { ...def, isCustom: false, variableId: null };
            }
          }
          return { ...def, isCustom: false, variableId: null };
        })
      );
      
      res.json(configuredDefinitions);
    } catch (error) {
      console.error("Error fetching flood config definitions:", error);
      res.status(500).json({ message: "Failed to fetch flood config definitions" });
    }
  });

  const floodConfigSchema = z.object({
    threshold: z.number().int().positive(),
    windowSeconds: z.number().int().positive(),
  });

  app.put("/api/flood-config/:eventName", requireAccess('admin'), async (req, res) => {
    try {
      const { eventName } = req.params;
      
      if (!floodEventRegistry.has(eventName)) {
        return res.status(404).json({ message: `Unknown flood event: ${eventName}` });
      }
      
      const parseResult = floodConfigSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid config", errors: parseResult.error.errors });
      }
      
      const { threshold, windowSeconds } = parseResult.data;
      const variableName = `flood_${eventName}`;
      const configValue = { threshold, windowSeconds };
      
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: configValue });
      } else {
        await storage.variables.create({
          name: variableName,
          value: configValue,
        });
      }
      
      floodEventRegistry.updateConfig(eventName, threshold, windowSeconds);
      
      res.json({ success: true, message: `Flood config for "${eventName}" updated` });
    } catch (error) {
      console.error("Error updating flood config:", error);
      res.status(500).json({ message: "Failed to update flood config" });
    }
  });

  app.delete("/api/flood-config/:eventName", requireAccess('admin'), async (req, res) => {
    try {
      const { eventName } = req.params;
      const variableName = `flood_${eventName}`;
      
      const variable = await storage.variables.getByName(variableName);
      if (variable) {
        await storage.variables.delete(variable.id);
      }
      
      floodEventRegistry.resetToDefaults(eventName);
      
      res.json({ success: true, message: `Flood config for "${eventName}" reset to default` });
    } catch (error) {
      console.error("Error resetting flood config:", error);
      res.status(500).json({ message: "Failed to reset flood config" });
    }
  });
}
