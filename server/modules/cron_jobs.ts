import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertCronJobSchema } from "@shared/schema";
import { requireAccess } from "../services/access-policy-evaluator";
import { cronScheduler, cronJobRegistry } from "../cron";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerCronJobRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // GET /api/cron-jobs - List all cron jobs
  app.get("/api/cron-jobs", requireAccess('admin'), async (req, res) => {
    try {
      const jobs = await storage.cronJobs.list();
      
      // Enrich each job with latest run information
      const jobsWithRuns = await Promise.all(jobs.map(async (job) => {
        const latestRun = await storage.cronJobRuns.getLatestByJobName(job.name);
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

  // GET /api/cron-jobs/:name - Get a specific cron job with latest run
  app.get("/api/cron-jobs/:name", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const job = await storage.cronJobs.getByName(name);
      
      if (!job) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const latestRun = await storage.cronJobRuns.getLatestByJobName(name);
      
      // Get handler metadata for settings
      const handler = cronJobRegistry.get(name);
      const settingsFields = handler?.getSettingsFields?.() ?? null;
      const defaultSettings = handler?.getDefaultSettings?.() ?? {};
      
      res.json({
        ...job,
        latestRun,
        settingsFields,
        defaultSettings
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job" });
    }
  });

  // GET /api/cron-jobs/:name/runs - Get run history for a specific job
  app.get("/api/cron-jobs/:name/runs", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const job = await storage.cronJobs.getByName(name);
      
      if (!job) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const runs = await storage.cronJobRuns.list({ jobName: name });
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job runs" });
    }
  });

  // PATCH /api/cron-jobs/:name - Update a cron job
  app.patch("/api/cron-jobs/:name", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      
      const existing = await storage.cronJobs.getByName(name);
      if (!existing) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const validatedData = insertCronJobSchema.partial().parse(req.body);

      // Prevent renaming via this endpoint (name is the primary key)
      if (validatedData.name && validatedData.name !== name) {
        return res.status(400).json({ message: "Cannot change job name (it is the primary key)" });
      }

      const job = await storage.cronJobs.update(name, validatedData);
      res.json(job);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid cron job data", error });
      } else {
        res.status(500).json({ message: "Failed to update cron job" });
      }
    }
  });

  // POST /api/cron-jobs/:name/run - Manually trigger a cron job
  app.post("/api/cron-jobs/:name/run", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const { mode = "live" } = req.body; // Accept mode from request body, default to "live"
      const user = req.user as any;
      
      // Validate mode parameter
      if (mode !== "live" && mode !== "test") {
        return res.status(400).json({ message: "Invalid mode. Must be 'live' or 'test'" });
      }
      
      const job = await storage.cronJobs.getByName(name);
      if (!job) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      // Get the user ID for audit trail
      const externalId = user.claims.sub;
      const identity = await storage.authIdentities.getByProviderAndExternalId("replit", externalId);
      if (!identity) {
        return res.status(401).json({ message: "User not found" });
      }
      const dbUser = await storage.users.getUser(identity.userId);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      // Execute the job via the scheduler (which handles run creation and logging)
      await cronScheduler.manualRun(name, dbUser.id, mode);

      // Get the latest run for this job to return to the client
      const latestRun = await storage.cronJobRuns.getLatestByJobName(name);

      res.status(201).json(latestRun);
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Failed to run cron job"
      });
    }
  });
}
