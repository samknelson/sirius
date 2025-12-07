import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { IStorage } from "../storage";
import { policies } from "../policies";
import { enqueueMonthScan, processBatchQueueJobs, invalidateWorkerScans } from "../services/wmb-scan-queue";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const enqueueMonthSchema = z.object({
  month: z.number().min(1).max(12),
  year: z.number().min(2000).max(2100),
});

const enqueueWorkerSchema = z.object({
  month: z.number().min(1).max(12),
  year: z.number().min(2000).max(2100),
});

const processBatchSchema = z.object({
  batchSize: z.number().min(1).max(100).optional().default(10),
});

export function registerWmbScanQueueRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/wmb-scan/status",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const statuses = await storage.wmbScanQueue.getAllMonthStatuses();
        res.json(statuses);
      } catch (error: any) {
        console.error("Error fetching WMB scan statuses:", error);
        res.status(500).json({ message: error.message || "Failed to fetch statuses" });
      }
    }
  );

  app.get(
    "/api/wmb-scan/status/:year/:month",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const month = parseInt(req.params.month);
        const year = parseInt(req.params.year);
        
        if (isNaN(month) || isNaN(year)) {
          return res.status(400).json({ message: "Invalid month or year" });
        }

        const status = await storage.wmbScanQueue.getMonthStatus(month, year);
        if (!status) {
          return res.status(404).json({ message: "Month status not found" });
        }

        const queueEntries = await storage.wmbScanQueue.getQueuedWorkers(status.id);
        res.json({ status, queueEntries });
      } catch (error: any) {
        console.error("Error fetching WMB scan month status:", error);
        res.status(500).json({ message: error.message || "Failed to fetch month status" });
      }
    }
  );

  app.get(
    "/api/wmb-scan/summary",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const summary = await storage.wmbScanQueue.getPendingSummary();
        res.json(summary);
      } catch (error: any) {
        console.error("Error fetching WMB scan summary:", error);
        res.status(500).json({ message: error.message || "Failed to fetch summary" });
      }
    }
  );

  app.post(
    "/api/wmb-scan/enqueue-month",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const validationResult = enqueueMonthSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({
            message: "Validation error",
            errors: validationResult.error.errors,
          });
        }

        const { month, year } = validationResult.data;
        const result = await enqueueMonthScan(storage, month, year);
        
        res.json({
          message: `Queued ${result.queuedCount} workers for ${month}/${year}`,
          ...result,
        });
      } catch (error: any) {
        console.error("Error enqueuing month scan:", error);
        res.status(500).json({ message: error.message || "Failed to enqueue month scan" });
      }
    }
  );

  app.post(
    "/api/wmb-scan/enqueue-worker/:workerId",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { workerId } = req.params;
        const validationResult = enqueueWorkerSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({
            message: "Validation error",
            errors: validationResult.error.errors,
          });
        }

        const { month, year } = validationResult.data;
        const entry = await storage.wmbScanQueue.enqueueWorker(workerId, month, year, "manual");
        
        res.json({
          message: `Worker ${workerId} queued for ${month}/${year}`,
          entry,
        });
      } catch (error: any) {
        console.error("Error enqueuing worker scan:", error);
        res.status(500).json({ message: error.message || "Failed to enqueue worker scan" });
      }
    }
  );

  app.post(
    "/api/wmb-scan/process-batch",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const validationResult = processBatchSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({
            message: "Validation error",
            errors: validationResult.error.errors,
          });
        }

        const { batchSize } = validationResult.data;
        const result = await processBatchQueueJobs(storage, batchSize);
        
        res.json({
          message: `Processed ${result.processed} jobs (${result.succeeded} succeeded, ${result.failed} failed)`,
          ...result,
        });
      } catch (error: any) {
        console.error("Error processing batch:", error);
        res.status(500).json({ message: error.message || "Failed to process batch" });
      }
    }
  );

  app.post(
    "/api/wmb-scan/invalidate-worker/:workerId",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { workerId } = req.params;
        const count = await invalidateWorkerScans(storage, workerId);
        
        res.json({
          message: `Invalidated ${count} scan entries for worker ${workerId}`,
          invalidatedCount: count,
        });
      } catch (error: any) {
        console.error("Error invalidating worker scans:", error);
        res.status(500).json({ message: error.message || "Failed to invalidate worker scans" });
      }
    }
  );
}
