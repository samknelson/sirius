import type { Express } from "express";
import { storage } from "../storage";
import { insertDispatchJobSchema, dispatchJobStatusEnum } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import type { DispatchJobFilters } from "../storage/dispatch-jobs";
import { dispatchEligPluginRegistry } from "../services/dispatch-elig-plugin-registry";
import { createDispatchEligibleWorkersStorage } from "../storage/dispatch-eligible-workers";
import { isComponentEnabledSync } from "../services/component-cache";

export function registerDispatchJobsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const dispatchComponent = requireComponent("dispatch");

  app.get("/api/dispatch-jobs", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { 
        employerId, 
        status, 
        jobTypeId, 
        startDateFrom, 
        startDateTo,
        page: pageParam,
        limit: limitParam 
      } = req.query;
      
      const page = parseInt(pageParam as string) || 0;
      const limit = Math.min(parseInt(limitParam as string) || 100, 100);
      
      const filters: DispatchJobFilters = {};
      
      if (employerId && typeof employerId === 'string') {
        filters.employerId = employerId;
      }
      if (status && typeof status === 'string' && dispatchJobStatusEnum.includes(status as any)) {
        filters.status = status;
      }
      if (jobTypeId && typeof jobTypeId === 'string') {
        filters.jobTypeId = jobTypeId;
      }
      if (startDateFrom && typeof startDateFrom === 'string') {
        filters.startDateFrom = new Date(startDateFrom);
      }
      if (startDateTo && typeof startDateTo === 'string') {
        filters.startDateTo = new Date(startDateTo);
      }
      
      const result = await storage.dispatchJobs.getPaginated(page, limit, filters);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch jobs" });
    }
  });

  app.get("/api/dispatch-jobs/:id", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.dispatchJobs.getWithRelations(id);
      
      if (!job) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      
      res.json(job);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dispatch job" });
    }
  });

  app.post("/api/dispatch-jobs", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      // Pre-process date to avoid timezone issues
      const body = { ...req.body };
      if (body.startDate && typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) {
        const [year, month, day] = body.startDate.split('-').map(Number);
        body.startDate = new Date(year, month - 1, day, 12, 0, 0);
      }
      
      const parsed = insertDispatchJobSchema.safeParse(body);
      
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

  app.put("/api/dispatch-jobs/:id", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const existingJob = await storage.dispatchJobs.get(id);
      
      if (!existingJob) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      
      const { employerId, jobTypeId, title, description, status, startDate, workerCount, data } = req.body;
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
      
      if (status !== undefined) {
        if (!dispatchJobStatusEnum.includes(status)) {
          res.status(400).json({ message: `Invalid status. Must be one of: ${dispatchJobStatusEnum.join(', ')}` });
          return;
        }
        updates.status = status;
      }
      
      if (startDate !== undefined) {
        // Parse date string as local date to avoid timezone shift
        // If it's a YYYY-MM-DD string, parse it as local noon to avoid boundary issues
        if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
          const [year, month, day] = startDate.split('-').map(Number);
          updates.startDate = new Date(year, month - 1, day, 12, 0, 0);
        } else {
          updates.startDate = new Date(startDate);
        }
      }
      
      if (workerCount !== undefined) {
        updates.workerCount = workerCount === null ? null : parseInt(workerCount, 10);
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

  app.delete("/api/dispatch-jobs/:id", dispatchComponent, requireAccess('admin'), async (req, res) => {
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

  app.get("/api/dispatch-eligibility-plugins", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const plugins = dispatchEligPluginRegistry.getAllPluginsMetadata();
      res.json(plugins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch eligibility plugins" });
    }
  });

  app.get("/api/dispatch-jobs/:id/eligible-workers", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { limit: limitParam, offset: offsetParam, siriusId: siriusIdParam, name: nameParam } = req.query;
      
      const limit = Math.min(parseInt(limitParam as string) || 100, 500);
      const offset = parseInt(offsetParam as string) || 0;
      
      const filters: { siriusId?: number; name?: string } = {};
      if (siriusIdParam) {
        const parsed = parseInt(siriusIdParam as string);
        if (!isNaN(parsed)) {
          filters.siriusId = parsed;
        }
      }
      if (nameParam && typeof nameParam === "string" && nameParam.trim()) {
        filters.name = nameParam.trim();
      }
      
      const eligibleWorkersStorage = createDispatchEligibleWorkersStorage();
      const result = await eligibleWorkersStorage.getEligibleWorkersForJob(id, limit, offset, Object.keys(filters).length > 0 ? filters : undefined);
      
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch eligible workers:", error);
      res.status(500).json({ message: "Failed to fetch eligible workers" });
    }
  });

  app.get("/api/dispatch-jobs/:id/eligible-workers-sql", dispatchComponent, requireAccess('admin'), async (req, res) => {
    try {
      if (!isComponentEnabledSync("debug")) {
        res.status(403).json({ message: "Debug component is not enabled" });
        return;
      }

      const { id } = req.params;
      const { limit: limitParam, offset: offsetParam, siriusId: siriusIdParam, name: nameParam } = req.query;
      
      const limit = Math.min(parseInt(limitParam as string) || 100, 500);
      const offset = parseInt(offsetParam as string) || 0;
      
      const filters: { siriusId?: number; name?: string } = {};
      if (siriusIdParam) {
        const parsed = parseInt(siriusIdParam as string);
        if (!isNaN(parsed)) {
          filters.siriusId = parsed;
        }
      }
      if (nameParam && typeof nameParam === "string" && nameParam.trim()) {
        filters.name = nameParam.trim();
      }
      
      const eligibleWorkersStorage = createDispatchEligibleWorkersStorage();
      const result = await eligibleWorkersStorage.getEligibleWorkersForJobSql(id, limit, offset, Object.keys(filters).length > 0 ? filters : undefined);
      
      if (!result) {
        res.status(404).json({ message: "Job not found" });
        return;
      }
      
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch eligible workers SQL:", error);
      res.status(500).json({ message: "Failed to fetch eligible workers SQL" });
    }
  });
}
