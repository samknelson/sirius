import type { Express } from "express";
import { storage } from "../storage";
import { insertCardcheckSchema } from "@shared/schema";
import { requireComponent } from "./components";

export function registerCardchecksRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  const cardcheckComponent = requireComponent("cardcheck");

  app.get("/api/workers/:workerId/cardchecks", requireAuth, cardcheckComponent, requirePermission("workers.view"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const cardchecks = await storage.cardchecks.getCardchecksByWorkerId(workerId);
      res.json(cardchecks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardchecks" });
    }
  });

  app.get("/api/cardcheck/:id", requireAuth, cardcheckComponent, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const cardcheck = await storage.cardchecks.getCardcheckById(id);
      
      if (!cardcheck) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json(cardcheck);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cardcheck" });
    }
  });

  app.post("/api/workers/:workerId/cardchecks", requireAuth, cardcheckComponent, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const data = { ...req.body, workerId };
      const parsed = insertCardcheckSchema.safeParse(data);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck data", errors: parsed.error.errors });
      }
      
      const cardcheck = await storage.cardchecks.createCardcheck(parsed.data);
      res.status(201).json(cardcheck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create cardcheck" });
    }
  });

  app.patch("/api/cardcheck/:id", requireAuth, cardcheckComponent, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const parsed = insertCardcheckSchema.partial().safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid cardcheck data", errors: parsed.error.errors });
      }
      
      const updatedCardcheck = await storage.cardchecks.updateCardcheck(id, parsed.data);
      
      if (!updatedCardcheck) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json(updatedCardcheck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update cardcheck" });
    }
  });

  app.delete("/api/cardcheck/:id", requireAuth, cardcheckComponent, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.cardchecks.deleteCardcheck(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Cardcheck not found" });
        return;
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete cardcheck" });
    }
  });
}
