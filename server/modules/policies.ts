import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { policies } from "../policies";
import { insertPolicySchema } from "@shared/schema";
import { z } from "zod";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updatePolicySchema = insertPolicySchema.partial();

export function registerPoliciesRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get("/api/policies", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const allPolicies = await storage.policies.getAllPolicies();
      res.json(allPolicies);
    } catch (error: any) {
      console.error("Error fetching policies:", error);
      res.status(500).json({ message: error.message || "Failed to fetch policies" });
    }
  });

  app.get("/api/policies/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const policy = await storage.policies.getPolicyById(id);
      if (!policy) {
        return res.status(404).json({ message: "Policy not found" });
      }
      res.json(policy);
    } catch (error: any) {
      console.error("Error fetching policy:", error);
      res.status(500).json({ message: error.message || "Failed to fetch policy" });
    }
  });

  app.post("/api/policies", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const validated = insertPolicySchema.parse(req.body);
      
      const existingPolicy = await storage.policies.getPolicyBySiriusId(validated.siriusId);
      if (existingPolicy) {
        return res.status(400).json({ message: "A policy with this Sirius ID already exists" });
      }
      
      const newPolicy = await storage.policies.createPolicy(validated);
      res.status(201).json(newPolicy);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating policy:", error);
      res.status(500).json({ message: error.message || "Failed to create policy" });
    }
  });

  app.put("/api/policies/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingPolicy = await storage.policies.getPolicyById(id);
      if (!existingPolicy) {
        return res.status(404).json({ message: "Policy not found" });
      }
      
      const validated = updatePolicySchema.parse(req.body);
      
      if (validated.siriusId && validated.siriusId !== existingPolicy.siriusId) {
        const duplicatePolicy = await storage.policies.getPolicyBySiriusId(validated.siriusId);
        if (duplicatePolicy) {
          return res.status(400).json({ message: "A policy with this Sirius ID already exists" });
        }
      }
      
      const updatedPolicy = await storage.policies.updatePolicy(id, validated);
      res.json(updatedPolicy);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating policy:", error);
      res.status(500).json({ message: error.message || "Failed to update policy" });
    }
  });

  app.delete("/api/policies/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existingPolicy = await storage.policies.getPolicyById(id);
      if (!existingPolicy) {
        return res.status(404).json({ message: "Policy not found" });
      }
      
      await storage.policies.deletePolicy(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting policy:", error);
      res.status(500).json({ message: error.message || "Failed to delete policy" });
    }
  });
}
