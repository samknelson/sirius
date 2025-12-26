import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import { policies } from "../policies";
import { insertWorkerStewardAssignmentSchema } from "@shared/schema";
import { z } from "zod";
import { assembleEmployerStewardDetails, assembleWorkerRepresentatives } from "../storage/worker-steward-assignments";
import { requireComponent } from "./components";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updateAssignmentSchema = insertWorkerStewardAssignmentSchema.partial();

export function registerWorkerStewardAssignmentRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const stewardComponent = requireComponent("worker.steward");

  app.get("/api/steward-assignments", requireAuth, stewardComponent, requireAccess(policies.workersView), async (req, res) => {
    try {
      const assignments = await storage.workerStewardAssignments.getAllAssignments();
      res.json(assignments);
    } catch (error: any) {
      console.error("Error fetching all steward assignments:", error);
      res.status(500).json({ message: error.message || "Failed to fetch steward assignments" });
    }
  });

  app.get("/api/workers/:workerId/steward-assignments", requireAuth, requireAccess(policies.workersManage), async (req, res) => {
    try {
      const { workerId } = req.params;
      const assignments = await storage.workerStewardAssignments.getAssignmentsByWorkerId(workerId);
      res.json(assignments);
    } catch (error: any) {
      console.error("Error fetching steward assignments:", error);
      res.status(500).json({ message: error.message || "Failed to fetch steward assignments" });
    }
  });

  app.get("/api/workers/:workerId/representatives", requireAuth, async (req, res) => {
    try {
      const { workerId } = req.params;
      const representatives = await assembleWorkerRepresentatives(storage, workerId);
      res.json(representatives);
    } catch (error: any) {
      console.error("Error fetching worker representatives:", error);
      res.status(500).json({ message: error.message || "Failed to fetch representatives" });
    }
  });

  app.get("/api/employers/:employerId/stewards", requireAuth, requireAccess(policies.employerUser), async (req, res) => {
    try {
      const { employerId } = req.params;
      const stewards = await assembleEmployerStewardDetails(storage, employerId);
      res.json(stewards);
    } catch (error: any) {
      console.error("Error fetching stewards for employer:", error);
      res.status(500).json({ message: error.message || "Failed to fetch stewards" });
    }
  });

  app.post("/api/workers/:workerId/steward-assignments", requireAuth, requireAccess(policies.workersManage), async (req, res) => {
    try {
      const { workerId } = req.params;
      const validated = insertWorkerStewardAssignmentSchema.parse({
        ...req.body,
        workerId,
      });
      
      const existing = await storage.workerStewardAssignments.findExistingAssignment(
        validated.workerId,
        validated.employerId,
        validated.bargainingUnitId
      );
      
      if (existing) {
        return res.status(400).json({ message: "An assignment with this employer and bargaining unit already exists for this worker" });
      }
      
      const assignment = await storage.workerStewardAssignments.createAssignment(validated);
      res.status(201).json(assignment);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating steward assignment:", error);
      res.status(500).json({ message: error.message || "Failed to create steward assignment" });
    }
  });

  app.patch("/api/workers/:workerId/steward-assignments/:id", requireAuth, requireAccess(policies.workersManage), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.workerStewardAssignments.getAssignmentById(id);
      if (!existing) {
        return res.status(404).json({ message: "Assignment not found" });
      }
      
      const validated = updateAssignmentSchema.parse(req.body);
      const updated = await storage.workerStewardAssignments.updateAssignment(id, validated);
      res.json(updated);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating steward assignment:", error);
      res.status(500).json({ message: error.message || "Failed to update steward assignment" });
    }
  });

  app.delete("/api/workers/:workerId/steward-assignments/:id", requireAuth, requireAccess(policies.workersManage), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.workerStewardAssignments.getAssignmentById(id);
      if (!existing) {
        return res.status(404).json({ message: "Assignment not found" });
      }
      
      const deleted = await storage.workerStewardAssignments.deleteAssignment(id);
      if (deleted) {
        res.json({ success: true });
      } else {
        res.status(500).json({ message: "Failed to delete assignment" });
      }
    } catch (error: any) {
      console.error("Error deleting steward assignment:", error);
      res.status(500).json({ message: error.message || "Failed to delete steward assignment" });
    }
  });
}
