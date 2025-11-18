import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertCronJobSchema, insertCronJobRunSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { cronScheduler } from "../cron";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerCronJobRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // GET /api/cron-jobs - List all cron jobs
  app.get("/api/cron-jobs", requireAccess(policies.admin), async (req, res) => {
    try {
      const jobs = await storage.cronJobs.list();
      
      // Enrich each job with latest run information
      const jobsWithRuns = await Promise.all(jobs.map(async (job) => {
        const latestRun = await storage.cronJobRuns.getLatestByJobId(job.id);
        return {
          ...job,
          latestRun
        };
      }));
      
      res.json(jobsWithRuns);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron jobs" });
    }
  });

  // GET /api/cron-jobs/:id - Get a specific cron job with its run history
  app.get("/api/cron-jobs/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.cronJobs.getById(id);
      
      if (!job) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const runs = await storage.cronJobRuns.list({ jobId: id });
      
      res.json({
        ...job,
        runs
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job" });
    }
  });

  // GET /api/cron-jobs/:id/runs - Get run history for a specific job
  app.get("/api/cron-jobs/:id/runs", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.cronJobs.getById(id);
      
      if (!job) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const runs = await storage.cronJobRuns.list({ jobId: id });
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job runs" });
    }
  });

  // POST /api/cron-jobs - Create a new cron job
  app.post("/api/cron-jobs", requireAccess(policies.admin), async (req, res) => {
    try {
      const validatedData = insertCronJobSchema.parse(req.body);

      // Check if a job with this name already exists
      const existing = await storage.cronJobs.getByName(validatedData.name);
      if (existing) {
        return res.status(409).json({ message: "A cron job with this name already exists" });
      }

      const job = await storage.cronJobs.create(validatedData);
      res.status(201).json(job);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid cron job data", error });
      } else {
        res.status(500).json({ message: "Failed to create cron job" });
      }
    }
  });

  // PATCH /api/cron-jobs/:id - Update a cron job
  app.patch("/api/cron-jobs/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.cronJobs.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const validatedData = insertCronJobSchema.partial().parse(req.body);

      // If updating name, check for duplicates
      if (validatedData.name && validatedData.name !== existing.name) {
        const nameConflict = await storage.cronJobs.getByName(validatedData.name);
        if (nameConflict) {
          return res.status(409).json({ message: "A cron job with this name already exists" });
        }
      }

      const job = await storage.cronJobs.update(id, validatedData);
      res.json(job);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid cron job data", error });
      } else {
        res.status(500).json({ message: "Failed to update cron job" });
      }
    }
  });

  // DELETE /api/cron-jobs/:id - Delete a cron job
  app.delete("/api/cron-jobs/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.cronJobs.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const success = await storage.cronJobs.delete(id);
      if (!success) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete cron job" });
    }
  });

  // POST /api/cron-jobs/:id/run - Manually trigger a cron job
  app.post("/api/cron-jobs/:id/run", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const user = req.user as any;
      
      const job = await storage.cronJobs.getById(id);
      if (!job) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      // Get the user ID for audit trail
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      // Execute the job via the scheduler (which handles run creation and logging)
      await cronScheduler.manualRun(id, dbUser.id);

      // Get the latest run for this job to return to the client
      const latestRun = await storage.cronJobRuns.getLatestByJobId(id);

      res.status(201).json(latestRun);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to run cron job"
      });
    }
  });
}
