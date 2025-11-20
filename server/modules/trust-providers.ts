import type { Express } from "express";
import { storage } from "../storage/database";
import { insertTrustProviderSchema, type InsertTrustProvider } from "@shared/schema";

export function registerTrustProvidersRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  // GET /api/trust-providers - Get all trust providers (requires workers.view permission)
  app.get("/api/trust-providers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const providers = await storage.trustProviders.getAllTrustProviders();
      res.json(providers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust providers" });
    }
  });

  // GET /api/trust-providers/:id - Get a specific trust provider (requires workers.view permission)
  app.get("/api/trust-providers/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const provider = await storage.trustProviders.getTrustProvider(id);
      
      if (!provider) {
        res.status(404).json({ message: "Trust provider not found" });
        return;
      }
      
      res.json(provider);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust provider" });
    }
  });

  // POST /api/trust-providers - Create a new trust provider (requires workers.manage permission)
  app.post("/api/trust-providers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const parsed = insertTrustProviderSchema.safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trust provider data", errors: parsed.error.errors });
      }
      
      const provider = await storage.trustProviders.createTrustProvider(parsed.data);
      res.status(201).json(provider);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create trust provider" });
    }
  });

  // PUT /api/trust-providers/:id - Update a trust provider (requires workers.manage permission)
  app.put("/api/trust-providers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, data } = req.body;
      
      const updates: Partial<InsertTrustProvider> = {};
      
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ message: "Trust provider name cannot be empty" });
        }
        updates.name = name.trim();
      }
      
      if (data !== undefined) {
        updates.data = data;
      }
      
      const updatedProvider = await storage.trustProviders.updateTrustProvider(id, updates);
      
      if (!updatedProvider) {
        res.status(404).json({ message: "Trust provider not found" });
        return;
      }
      
      res.json(updatedProvider);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update trust provider" });
    }
  });

  // DELETE /api/trust-providers/:id - Delete a trust provider (requires workers.manage permission)
  app.delete("/api/trust-providers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.trustProviders.deleteTrustProvider(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Trust provider not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete trust provider" });
    }
  });
}
