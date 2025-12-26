import type { Express } from "express";
import { storage } from "../storage";
import { insertDispatchJobSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { requireComponent } from "./components";

export function registerDispatchJobsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const dispatchComponent = requireComponent("dispatch");

  app.get("/api/dispatch-jobs", dispatchComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { employerId } = req.query;
      
      if (employerId && typeof employerId === 'string') {
        const jobs = await storage.dispatchJobs.getByEmployer(employerId);
        res.json(jobs);
      } else {
        const jobs = await storage.dispatchJobs.getAll();
        res.json(jobs);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch jobs" });
    }
  });

  app.get("/api/dispatch-jobs/:id", dispatchComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.dispatchJobs.get(id);
      
      if (!job) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      
      res.json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch job" });
    }
  });

  app.post("/api/dispatch-jobs", dispatchComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const parsed = insertDispatchJobSchema.safeParse(req.body);
      
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }
      
      const employer = await storage.employers.getEmployer(parsed.data.employerId);
      if (!employer) {
        res.status(400).json({ message: "Employer not found" });
        return;
      }
      
      if (parsed.data.jobTypeId) {
        const jobType = await storage.options.dispatchJobTypes.get(parsed.data.jobTypeId);
        if (!jobType) {
          res.status(400).json({ message: "Job type not found" });
          return;
        }
      }
      
      const job = await storage.dispatchJobs.create(parsed.data);
      res.status(201).json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to create dispatch job" });
    }
  });

  app.put("/api/dispatch-jobs/:id", dispatchComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const existingJob = await storage.dispatchJobs.get(id);
      
      if (!existingJob) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      
      const { employerId, jobTypeId, title, description, startDate, data } = req.body;
      const updates: any = {};
      
      if (employerId !== undefined) {
        const employer = await storage.employers.getEmployer(employerId);
        if (!employer) {
          res.status(400).json({ message: "Employer not found" });
          return;
        }
        updates.employerId = employerId;
      }
      
      if (jobTypeId !== undefined) {
        if (jobTypeId === null) {
          updates.jobTypeId = null;
        } else {
          const jobType = await storage.options.dispatchJobTypes.get(jobTypeId);
          if (!jobType) {
            res.status(400).json({ message: "Job type not found" });
            return;
          }
          updates.jobTypeId = jobTypeId;
        }
      }
      
      if (title !== undefined) {
        if (typeof title !== 'string' || !title.trim()) {
          res.status(400).json({ message: "Title must be a non-empty string" });
          return;
        }
        updates.title = title.trim();
      }
      
      if (description !== undefined) {
        updates.description = description;
      }
      
      if (startDate !== undefined) {
        updates.startDate = new Date(startDate);
      }
      
      if (data !== undefined) {
        updates.data = data;
      }
      
      const job = await storage.dispatchJobs.update(id, updates);
      res.json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to update dispatch job" });
    }
  });

  app.delete("/api/dispatch-jobs/:id", dispatchComponent, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.dispatchJobs.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete dispatch job" });
    }
  });
}
