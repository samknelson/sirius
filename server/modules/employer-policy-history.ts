import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { insertEmployerPolicyHistorySchema } from "@shared/schema";
import { z } from "zod";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const createSchema = insertEmployerPolicyHistorySchema.omit({ createdAt: true });
const updateSchema = createSchema.partial().omit({ employerId: true });

export function registerEmployerPolicyHistoryRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get("/api/employers/:employerId/policy-history", requireAuth, requireAccess('employer.self', (req) => req.params.employerId), async (req, res) => {
    try {
      const { employerId } = req.params;
      
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        return res.status(404).json({ message: "Employer not found" });
      }
      
      const history = await storage.employerPolicyHistory.getEmployerPolicyHistory(employerId);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching employer policy history:", error);
      res.status(500).json({ message: error.message || "Failed to fetch policy history" });
    }
  });

  app.post("/api/employers/:employerId/policy-history", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { employerId } = req.params;
      
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        return res.status(404).json({ message: "Employer not found" });
      }
      
      const validated = createSchema.parse({
        ...req.body,
        employerId,
      });
      
      const policy = await storage.policies.getPolicyById(validated.policyId);
      if (!policy) {
        return res.status(400).json({ message: "Policy not found" });
      }
      
      const newEntry = await storage.employerPolicyHistory.createEmployerPolicyHistory(validated);
      res.status(201).json(newEntry);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating policy history entry:", error);
      res.status(500).json({ message: error.message || "Failed to create policy history entry" });
    }
  });

  app.put("/api/employers/:employerId/policy-history/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const validated = updateSchema.parse(req.body);
      
      if (validated.policyId) {
        const policy = await storage.policies.getPolicyById(validated.policyId);
        if (!policy) {
          return res.status(400).json({ message: "Policy not found" });
        }
      }
      
      const updated = await storage.employerPolicyHistory.updateEmployerPolicyHistory(id, validated);
      if (!updated) {
        return res.status(404).json({ message: "Policy history entry not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating policy history entry:", error);
      res.status(500).json({ message: error.message || "Failed to update policy history entry" });
    }
  });

  app.delete("/api/employers/:employerId/policy-history/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.employerPolicyHistory.deleteEmployerPolicyHistory(id);
      if (!deleted) {
        return res.status(404).json({ message: "Policy history entry not found" });
      }
      
      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting policy history entry:", error);
      res.status(500).json({ message: error.message || "Failed to delete policy history entry" });
    }
  });
}
