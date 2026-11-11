import type { Express } from "express";
import { storage } from "../../storage";
import { insertTrustBenefitSchema, type InsertTrustBenefit } from "@shared/schema";
import { getOptionsStorage } from "../options-registry";

async function colorOptionExists(colorOptionId: string | null | undefined): Promise<boolean> {
  if (colorOptionId == null) return true;
  return Boolean(await getOptionsStorage().get("color", colorOptionId));
}

export function registerTrustBenefitsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  // GET /api/trust-benefits - List trust benefits (any authenticated user; needed by employer-facing wizards)
  app.get("/api/trust-benefits", requireAuth, async (req, res) => {
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
  app.get("/api/trust-benefits/:id", requireAuth, requirePermission("staff"), async (req, res) => {
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
  app.post("/api/trust-benefits", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      if (req.body?.color !== undefined) {
        return res.status(400).json({ message: "Use colorOptionId to select a configured benefit color" });
      }
      const parsed = insertTrustBenefitSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trust benefit data", errors: parsed.error.errors });
      }
      
      const data = {
        ...parsed.data,
        colorOptionId: parsed.data.colorOptionId || null,
        siriusId: typeof parsed.data.siriusId === "string" && parsed.data.siriusId.trim()
          ? parsed.data.siriusId.trim()
          : null,
      };
      if (!(await colorOptionExists(data.colorOptionId))) {
        return res.status(400).json({ message: "Select a configured benefit color or choose no color" });
      }
      
      const benefit = await storage.trustBenefits.createTrustBenefit(data);
      res.status(201).json(benefit);
    } catch (error: any) {
      if (error?.message?.includes("ID already exists")) {
        return res.status(409).json({ message: "That ID is already in use by another trust benefit" });
      }
      if ((error?.code ?? error?.cause?.code) === "23503") {
        return res.status(400).json({ message: "A selected benefit color, type, or provider no longer exists" });
      }
      res.status(500).json({ message: "Failed to create trust benefit" });
    }
  });

  // PUT /api/trust-benefits/:id - Update a trust benefit (requires workers.manage permission)
  app.put("/api/trust-benefits/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      if (req.body?.color !== undefined) {
        return res.status(400).json({ message: "Use colorOptionId to select a configured benefit color" });
      }
      const { name, benefitType, colorOptionId, showOnWorkerList, isActive, description, siriusId, providerId } = req.body;
      
      const updates: Partial<InsertTrustBenefit> = {};
      
      if (siriusId !== undefined) {
        if (siriusId !== null && typeof siriusId !== "string") {
          return res.status(400).json({ message: "ID must be a string" });
        }
        updates.siriusId = typeof siriusId === "string" && siriusId.trim() ? siriusId.trim() : null;
      }
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Trust benefit name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (benefitType !== undefined) {
        updates.benefitType = benefitType;
      }
      
      if (colorOptionId !== undefined) {
        if (colorOptionId !== null && typeof colorOptionId !== "string") {
          return res.status(400).json({ message: "Color option must be an ID or null" });
        }
        updates.colorOptionId = typeof colorOptionId === "string" && colorOptionId.trim()
          ? colorOptionId.trim()
          : null;
        if (!(await colorOptionExists(updates.colorOptionId))) {
          return res.status(400).json({ message: "Select a configured benefit color or choose no color" });
        }
      }
      
      if (showOnWorkerList !== undefined) {
        if (typeof showOnWorkerList !== 'boolean') {
          return res.status(400).json({ message: "showOnWorkerList must be a boolean" });
        }
        updates.showOnWorkerList = showOnWorkerList;
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
      
      if (providerId !== undefined) {
        if (providerId !== null && typeof providerId !== "string") {
          return res.status(400).json({ message: "providerId must be a string or null" });
        }
        updates.providerId = typeof providerId === "string" && providerId.trim() ? providerId : null;
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
    } catch (error: any) {
      if (error?.message?.includes("ID already exists")) {
        return res.status(409).json({ message: "That ID is already in use by another trust benefit" });
      }
      if ((error?.code ?? error?.cause?.code) === "23503") {
        return res.status(400).json({ message: "A selected benefit color, type, or provider no longer exists" });
      }
      res.status(500).json({ message: "Failed to update trust benefit" });
    }
  });

  // DELETE /api/trust-benefits/:id - Delete a trust benefit (requires workers.manage permission)
  app.delete("/api/trust-benefits/:id", requireAuth, requirePermission("staff"), async (req, res) => {
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
