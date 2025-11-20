import type { Express } from "express";
import { storage } from "../storage/database";
import { db } from "../db";
import { insertTrustProviderSchema, type InsertTrustProvider, winstonLogs } from "@shared/schema";
import { policies } from "../policies";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export function registerTrustProvidersRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  // GET /api/trust/providers - Get all trust providers (requires workers.view permission)
  app.get("/api/trust/providers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const providers = await storage.trustProviders.getAllTrustProviders();
      res.json(providers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust providers" });
    }
  });

  // GET /api/trust/provider/:id - Get a specific trust provider (requires workers.view permission)
  app.get("/api/trust/provider/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
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

  // POST /api/trust/providers - Create a new trust provider (requires workers.manage permission)
  app.post("/api/trust/providers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
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

  // PATCH /api/trust/provider/:id - Update a trust provider (requires workers.manage permission)
  app.patch("/api/trust/provider/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Validate request body using partial insert schema
      const parsed = insertTrustProviderSchema.partial().safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid trust provider data", errors: parsed.error.errors });
      }
      
      const updates = parsed.data;
      
      // Additional validation for name field if present
      if (updates.name !== undefined && !updates.name.trim()) {
        return res.status(400).json({ message: "Trust provider name cannot be empty" });
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

  // DELETE /api/trust/provider/:id - Delete a trust provider (requires workers.manage permission)
  app.delete("/api/trust/provider/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
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

  // GET /api/trust/provider/:id/logs - Get all logs related to a trust provider (requires staff permission)
  app.get("/api/trust/provider/:id/logs", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { id } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Get the provider to ensure it exists
      const provider = await storage.trustProviders.getTrustProvider(id);
      if (!provider) {
        return res.status(404).json({ message: "Trust provider not found" });
      }

      // Build query conditions
      const conditions = [eq(winstonLogs.hostEntityId, id)];
      
      if (module && typeof module === 'string') {
        conditions.push(eq(winstonLogs.module, module));
      }
      if (operation && typeof operation === 'string') {
        conditions.push(eq(winstonLogs.operation, operation));
      }
      if (startDate && typeof startDate === 'string') {
        conditions.push(gte(winstonLogs.timestamp, new Date(startDate)));
      }
      if (endDate && typeof endDate === 'string') {
        conditions.push(lte(winstonLogs.timestamp, new Date(endDate)));
      }

      // Execute query with all conditions and order by timestamp descending (newest first)
      const logs = await db
        .select()
        .from(winstonLogs)
        .where(and(...conditions))
        .orderBy(desc(winstonLogs.timestamp));

      res.json(logs);
    } catch (error: any) {
      console.error("Failed to fetch trust provider logs:", error);
      res.status(500).json({ message: "Failed to fetch trust provider logs" });
    }
  });
}
