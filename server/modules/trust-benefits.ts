import type { Express } from "express";
import { storage } from "../storage";
import { insertTrustBenefitSchema, type InsertTrustBenefit } from "@shared/schema";

export function registerTrustBenefitsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  // GET /api/trust-benefits - Get all trust benefits (requires workers.view permission)
  app.get("/api/trust-benefits", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const includeInactive = req.query.includeInactive === 'true';
      const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
      
      const benefits = includeInactive 
        ? allBenefits 
        : allBenefits.filter(benefit => benefit.isActive);
      
      res.json(benefits);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefits" });
    }
  });

  // GET /api/trust-benefits/:id - Get a specific trust benefit (requires workers.view permission)
  app.get("/api/trust-benefits/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const benefit = await storage.trustBenefits.getTrustBenefit(id);
      
      if (!benefit) {
        res.status(404).json({ message: "Trust benefit not found" });
        return;
      }
      
      res.json(benefit);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust benefit" });
    }
  });

  // POST /api/trust-benefits - Create a new trust benefit (requires workers.manage permission)
  app.post("/api/trust-benefits", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const parsed = insertTrustBenefitSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trust benefit data", errors: parsed.error.errors });
      }
      
      const benefit = await storage.trustBenefits.createTrustBenefit(parsed.data);
      res.status(201).json(benefit);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create trust benefit" });
    }
  });

  // PUT /api/trust-benefits/:id - Update a trust benefit (requires workers.manage permission)
  app.put("/api/trust-benefits/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, benefitType, isActive, description } = req.body;
      
      const updates: Partial<InsertTrustBenefit> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Trust benefit name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (benefitType !== undefined) {
        updates.benefitType = benefitType;
      }
      
      if (isActive !== undefined) {
        if (typeof isActive !== 'boolean') {
          return res.status(400).json({ message: "isActive must be a boolean" });
        }
        updates.isActive = isActive;
      }
      
      if (description !== undefined) {
        updates.description = description;
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      
      const benefit = await storage.trustBenefits.updateTrustBenefit(id, updates);
      
      if (!benefit) {
        res.status(404).json({ message: "Trust benefit not found" });
        return;
      }
      
      res.json(benefit);
    } catch (error) {
      res.status(500).json({ message: "Failed to update trust benefit" });
    }
  });

  // DELETE /api/trust-benefits/:id - Delete a trust benefit (requires workers.manage permission)
  app.delete("/api/trust-benefits/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.trustBenefits.deleteTrustBenefit(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Trust benefit not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete trust benefit" });
    }
  });
}
