import type { Express } from "express";
import { storage } from "../storage";
import { insertCardcheckDefinitionSchema } from "@shared/schema";
import { requireComponent } from "./components";

export function registerCardcheckDefinitionsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  const cardcheckComponent = requireComponent("cardcheck");

  app.get("/api/cardcheck/definitions", requireAuth, cardcheckComponent, requirePermission("workers.view"), async (req, res) => {
    try {
      const definitions = await storage.cardcheckDefinitions.getAllCardcheckDefinitions();
      res.json(definitions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck definitions" });
    }
  });

  app.get("/api/cardcheck/definition/:id", requireAuth, cardcheckComponent, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const definition = await storage.cardcheckDefinitions.getCardcheckDefinitionById(id);
      
      if (!definition) {
        res.status(404).json({ message: "Cardcheck definition not found" });
        return;
      }
      
      res.json(definition);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck definition" });
    }
  });

  app.post("/api/cardcheck/definitions", requireAuth, cardcheckComponent, requirePermission("workers.manage"), async (req, res) => {
    try {
      const parsed = insertCardcheckDefinitionSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck definition data", errors: parsed.error.errors });
      }
      
      const definition = await storage.cardcheckDefinitions.createCardcheckDefinition(parsed.data);
      res.status(201).json(definition);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(400).json({ message: "A cardcheck definition with this Sirius ID already exists" });
      }
      res.status(500).json({ message: "Failed to create cardcheck definition" });
    }
  });

  app.patch("/api/cardcheck/definition/:id", requireAuth, cardcheckComponent, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const parsed = insertCardcheckDefinitionSchema.partial().safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck definition data", errors: parsed.error.errors });
      }
      
      const updates = parsed.data;
      
      if (updates.name !== undefined && !updates.name.trim()) {
        return res.status(400).json({ message: "Cardcheck definition name cannot be empty" });
      }
      
      const updatedDefinition = await storage.cardcheckDefinitions.updateCardcheckDefinition(id, updates);
      
      if (!updatedDefinition) {
        res.status(404).json({ message: "Cardcheck definition not found" });
        return;
      }
      
      res.json(updatedDefinition);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(400).json({ message: "A cardcheck definition with this Sirius ID already exists" });
      }
      res.status(500).json({ message: "Failed to update cardcheck definition" });
    }
  });

  app.delete("/api/cardcheck/definition/:id", requireAuth, cardcheckComponent, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.cardcheckDefinitions.deleteCardcheckDefinition(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Cardcheck definition not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete cardcheck definition" });
    }
  });
}
