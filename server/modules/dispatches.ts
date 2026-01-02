import type { Express } from "express";
import { storage } from "../storage";
import { insertDispatchSchema, dispatchStatusEnum } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { requireComponent } from "./components";

export function registerDispatchesRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const dispatchComponent = requireComponent("dispatch");

  app.get("/api/dispatches/job/:jobId", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { jobId } = req.params;
      
      const job = await storage.dispatchJobs.get(jobId);
      if (!job) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      
      const dispatches = await storage.dispatches.getByJob(jobId);
      res.json(dispatches);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatches" });
    }
  });

  app.get("/api/dispatches/worker/:workerId", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { workerId } = req.params;
      
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      const dispatches = await storage.dispatches.getByWorker(workerId);
      res.json(dispatches);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatches" });
    }
  });

  app.get("/api/dispatches/:id", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const dispatch = await storage.dispatches.getWithRelations(id);
      
      if (!dispatch) {
        res.status(404).json({ message: "Dispatch not found" });
        return;
      }
      
      res.json(dispatch);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch" });
    }
  });

  app.post("/api/dispatches", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const parsed = insertDispatchSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }
      
      const job = await storage.dispatchJobs.get(parsed.data.jobId);
      if (!job) {
        res.status(400).json({ message: "Dispatch job not found" });
        return;
      }
      
      const worker = await storage.workers.getWorker(parsed.data.workerId);
      if (!worker) {
        res.status(400).json({ message: "Worker not found" });
        return;
      }
      
      const dispatch = await storage.dispatches.create(parsed.data);
      res.status(201).json(dispatch);
    } catch (error) {
      res.status(500).json({ message: "Failed to create dispatch" });
    }
  });

  app.put("/api/dispatches/:id", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await storage.dispatches.get(id);
      
      if (!existing) {
        res.status(404).json({ message: "Dispatch not found" });
        return;
      }
      
      const { status, data, startDate, endDate } = req.body;
      const updates: any = {};
      
      if (status !== undefined) {
        if (!dispatchStatusEnum.includes(status)) {
          res.status(400).json({ message: `Invalid status. Must be one of: ${dispatchStatusEnum.join(', ')}` });
          return;
        }
        updates.status = status;
      }
      
      if (data !== undefined) {
        updates.data = data;
      }
      
      if (startDate !== undefined) {
        updates.startDate = startDate ? new Date(startDate) : null;
      }
      
      if (endDate !== undefined) {
        updates.endDate = endDate ? new Date(endDate) : null;
      }
      
      const dispatch = await storage.dispatches.update(id, updates);
      res.json(dispatch);
    } catch (error) {
      res.status(500).json({ message: "Failed to update dispatch" });
    }
  });

  app.delete("/api/dispatches/:id", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.dispatches.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Dispatch not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete dispatch" });
    }
  });
}
