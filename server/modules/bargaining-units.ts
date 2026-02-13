import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertBargainingUnitSchema } from "@shared/schema";
import { z } from "zod";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updateBargainingUnitSchema = insertBargainingUnitSchema.partial();

export function registerBargainingUnitsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get("/api/bargaining-units", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const allBargainingUnits = await storage.bargainingUnits.getAllBargainingUnits();
      res.json(allBargainingUnits);
    } catch (error: any) {
      console.error("Error fetching bargaining units:", error);
      res.status(500).json({ message: error.message || "Failed to fetch bargaining units" });
    }
  });

  app.get("/api/bargaining-units/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const bargainingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!bargainingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      res.json(bargainingUnit);
    } catch (error: any) {
      console.error("Error fetching bargaining unit:", error);
      res.status(500).json({ message: error.message || "Failed to fetch bargaining unit" });
    }
  });

  app.post("/api/bargaining-units", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const validated = insertBargainingUnitSchema.parse(req.body);
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitBySiriusId(validated.siriusId);
      if (existingUnit) {
        return res.status(400).json({ message: "A bargaining unit with this Sirius ID already exists" });
      }
      
      const newBargainingUnit = await storage.bargainingUnits.createBargainingUnit(validated);
      res.status(201).json(newBargainingUnit);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating bargaining unit:", error);
      res.status(500).json({ message: error.message || "Failed to create bargaining unit" });
    }
  });

  app.put("/api/bargaining-units/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      const validated = updateBargainingUnitSchema.parse(req.body);
      
      if (validated.siriusId && validated.siriusId !== existingUnit.siriusId) {
        const duplicateUnit = await storage.bargainingUnits.getBargainingUnitBySiriusId(validated.siriusId);
        if (duplicateUnit) {
          return res.status(400).json({ message: "A bargaining unit with this Sirius ID already exists" });
        }
      }
      
      const updatedBargainingUnit = await storage.bargainingUnits.updateBargainingUnit(id, validated);
      res.json(updatedBargainingUnit);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating bargaining unit:", error);
      res.status(500).json({ message: error.message || "Failed to update bargaining unit" });
    }
  });

  app.patch("/api/bargaining-units/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      const validated = updateBargainingUnitSchema.parse(req.body);
      
      if (validated.siriusId && validated.siriusId !== existingUnit.siriusId) {
        const duplicateUnit = await storage.bargainingUnits.getBargainingUnitBySiriusId(validated.siriusId);
        if (duplicateUnit) {
          return res.status(400).json({ message: "A bargaining unit with this Sirius ID already exists" });
        }
      }
      
      const updatedBargainingUnit = await storage.bargainingUnits.updateBargainingUnit(id, validated);
      res.json(updatedBargainingUnit);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating bargaining unit:", error);
      res.status(500).json({ message: error.message || "Failed to update bargaining unit" });
    }
  });

  app.delete("/api/bargaining-units/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      await storage.bargainingUnits.deleteBargainingUnit(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting bargaining unit:", error);
      res.status(500).json({ message: error.message || "Failed to delete bargaining unit" });
    }
  });

  app.get("/api/bargaining-units/:id/rates", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const rates = await storage.bargainingUnits.getAccountRates(id);
      if (rates === undefined) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      res.json(rates);
    } catch (error: any) {
      console.error("Error fetching account rates:", error);
      res.status(500).json({ message: error.message || "Failed to fetch account rates" });
    }
  });

  app.post("/api/bargaining-units/:id/rates/:accountId", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id, accountId } = req.params;
      const { name, rate } = req.body;
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      if (typeof rate !== 'number' || isNaN(rate)) {
        return res.status(400).json({ message: "Rate must be a valid number" });
      }
      
      if (rate < 0) {
        return res.status(400).json({ message: "Rate cannot be negative" });
      }
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      const account = await storage.ledger.accounts.get(accountId);
      if (!account) {
        return res.status(404).json({ message: "Ledger account not found" });
      }
      
      const updated = await storage.bargainingUnits.setAccountRate(id, accountId, name.trim(), rate);
      res.json(updated);
    } catch (error: any) {
      console.error("Error adding account rate:", error);
      res.status(500).json({ message: error.message || "Failed to add account rate" });
    }
  });

  app.put("/api/bargaining-units/:id/rates/:accountId/:rateIndex", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id, accountId } = req.params;
      const rateIndex = parseInt(req.params.rateIndex, 10);
      const { name, rate } = req.body;
      
      if (isNaN(rateIndex) || rateIndex < 0) {
        return res.status(400).json({ message: "Invalid rate index" });
      }
      
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      
      if (typeof rate !== 'number' || isNaN(rate)) {
        return res.status(400).json({ message: "Rate must be a valid number" });
      }
      
      if (rate < 0) {
        return res.status(400).json({ message: "Rate cannot be negative" });
      }
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      const updated = await storage.bargainingUnits.updateAccountRate(id, accountId, rateIndex, name.trim(), rate);
      if (!updated) {
        return res.status(404).json({ message: "Rate entry not found at the specified index" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating account rate:", error);
      res.status(500).json({ message: error.message || "Failed to update account rate" });
    }
  });

  app.delete("/api/bargaining-units/:id/rates/:accountId/:rateIndex", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id, accountId } = req.params;
      const rateIndex = parseInt(req.params.rateIndex, 10);
      
      if (isNaN(rateIndex) || rateIndex < 0) {
        return res.status(400).json({ message: "Invalid rate index" });
      }
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      const updated = await storage.bargainingUnits.removeAccountRateEntry(id, accountId, rateIndex);
      if (!updated) {
        return res.status(404).json({ message: "Rate entry not found at the specified index" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error removing account rate:", error);
      res.status(500).json({ message: error.message || "Failed to remove account rate" });
    }
  });

  app.delete("/api/bargaining-units/:id/rates/:accountId", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id, accountId } = req.params;
      
      const existingUnit = await storage.bargainingUnits.getBargainingUnitById(id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Bargaining unit not found" });
      }
      
      const updated = await storage.bargainingUnits.removeAccountRate(id, accountId);
      res.json(updated);
    } catch (error: any) {
      console.error("Error removing account rates:", error);
      res.status(500).json({ message: error.message || "Failed to remove account rates" });
    }
  });
}
