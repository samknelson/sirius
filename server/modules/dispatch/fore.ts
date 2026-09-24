import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";

const addForeSchema = z.object({
  workerId: z.string().min(1),
});

export function registerDispatchForeRoutes(app: Express) {
  const foreComponent = requireComponent("dispatch.fore");

  // List forepersons on a job
  app.get("/api/dispatch-jobs/:jobId/fore", foreComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.dispatchJobs.get(jobId);
      if (!job) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      const forepersons = await storage.dispatchJobFore.getByJob(jobId);
      res.json(forepersons);
    } catch (error: any) {
      console.error("Failed to fetch forepersons:", error?.message || error);
      res.status(500).json({ message: "Failed to fetch forepersons" });
    }
  });

  // Jobs where a worker is a foreperson (worker dispatch status page)
  app.get("/api/workers/:workerId/dispatch-fore", foreComponent, requireAccess('worker.view', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      const foreJobs = await storage.dispatchJobFore.getByWorker(workerId);
      res.json(foreJobs);
    } catch (error: any) {
      console.error("Failed to fetch worker foreperson jobs:", error?.message || error);
      res.status(500).json({ message: "Failed to fetch foreperson jobs" });
    }
  });

  // Eligible workers picker: accepted primary dispatch at the job's employer,
  // not already a foreperson on this job.
  app.get("/api/dispatch-jobs/:jobId/fore/eligible", foreComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.dispatchJobs.get(jobId);
      if (!job) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }
      const eligible = await storage.dispatchJobFore.getEligibleWorkers(jobId);
      res.json(eligible);
    } catch (error: any) {
      console.error("Failed to fetch eligible forepersons:", error?.message || error);
      res.status(500).json({ message: "Failed to fetch eligible workers" });
    }
  });

  // Add a foreperson. Route-level eligibility check: the worker must have an
  // accepted primary dispatch at the job's employer (storage does not enforce
  // this — a foreperson whose dispatch later ends is intentionally retained).
  app.post("/api/dispatch-jobs/:jobId/fore", foreComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { jobId } = req.params;
      const parsed = addForeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
        return;
      }

      const job = await storage.dispatchJobs.get(jobId);
      if (!job) {
        res.status(404).json({ message: "Dispatch job not found" });
        return;
      }

      const worker = await storage.workers.getWorker(parsed.data.workerId);
      if (!worker) {
        res.status(400).json({ message: "Worker not found" });
        return;
      }

      const existing = await storage.dispatchJobFore.getByJobAndWorker(jobId, parsed.data.workerId);
      if (existing) {
        res.status(409).json({ message: "Worker is already a Foreperson on this job" });
        return;
      }

      const eligible = await storage.dispatchJobFore.getEligibleWorkers(jobId);
      if (!eligible.some(w => w.id === parsed.data.workerId)) {
        res.status(400).json({
          message: "Worker is not eligible: an accepted primary dispatch at this job's employer is required",
        });
        return;
      }

      const fore = await storage.dispatchJobFore.create({
        jobId,
        workerId: parsed.data.workerId,
      });
      res.status(201).json(fore);
    } catch (error: any) {
      console.error("Failed to add foreperson:", error?.message || error);
      res.status(500).json({ message: "Failed to add foreperson" });
    }
  });

  // Remove a foreperson
  app.delete("/api/dispatch-jobs/:jobId/fore/:foreId", foreComponent, requireAccess('admin'), async (req, res) => {
    try {
      const { jobId, foreId } = req.params;
      const fore = await storage.dispatchJobFore.get(foreId);
      if (!fore || fore.jobId !== jobId) {
        res.status(404).json({ message: "Foreperson not found on this job" });
        return;
      }
      await storage.dispatchJobFore.delete(foreId);
      res.status(204).send();
    } catch (error: any) {
      console.error("Failed to remove foreperson:", error?.message || error);
      res.status(500).json({ message: "Failed to remove foreperson" });
    }
  });
}
