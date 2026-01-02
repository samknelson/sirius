import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { IStorage } from "../storage";
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

const pagedEntriesQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  pageSize: z.coerce.number().min(1).max(100).optional().default(50),
  search: z.string().optional(),
  outcome: z.enum(["started", "continued", "terminated"]).optional(),
  status: z.string().optional(),
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
    requireAccess('admin'),
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
    requireAccess('admin'),
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
    requireAccess('admin'),
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

  app.get(
    "/api/wmb-scan/detail/:id",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const status = await storage.wmbScanQueue.getStatusById(id);
        if (!status) {
          return res.status(404).json({ message: "Scan status not found" });
        }
        
        res.json({ status });
      } catch (error: any) {
        console.error("Error fetching WMB scan detail:", error);
        res.status(500).json({ message: error.message || "Failed to fetch scan detail" });
      }
    }
  );

  app.get(
    "/api/wmb-scan/detail/:id/entries",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const validation = pagedEntriesQuerySchema.safeParse(req.query);
        if (!validation.success) {
          return res.status(400).json({
            message: "Validation error",
            errors: validation.error.errors,
          });
        }
        
        const { page, pageSize, search, outcome, status: queueStatus } = validation.data;
        
        const status = await storage.wmbScanQueue.getStatusById(id);
        if (!status) {
          return res.status(404).json({ message: "Scan status not found" });
        }
        
        const result = await storage.wmbScanQueue.getQueueEntriesPaged(id, page, pageSize, {
          search,
          outcome,
          status: queueStatus,
        });
        
        res.json(result);
      } catch (error: any) {
        console.error("Error fetching paged WMB scan entries:", error);
        res.status(500).json({ message: error.message || "Failed to fetch scan entries" });
      }
    }
  );

  app.get(
    "/api/wmb-scan/detail/:id/export",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { id } = req.params;
        const validation = pagedEntriesQuerySchema.safeParse(req.query);
        if (!validation.success) {
          return res.status(400).json({
            message: "Validation error",
            errors: validation.error.errors,
          });
        }
        
        const { search, outcome, status: queueStatus } = validation.data;
        
        const status = await storage.wmbScanQueue.getStatusById(id);
        if (!status) {
          return res.status(404).json({ message: "Scan status not found" });
        }
        
        // Get all filtered entries (no pagination limit for export)
        const result = await storage.wmbScanQueue.getQueueEntriesPaged(id, 1, 100000, {
          search,
          outcome,
          status: queueStatus,
        });
        
        // Build CSV
        const headers = [
          "Sirius ID",
          "Worker Name",
          "Worker ID",
          "Status",
          "Trigger Source",
          "Attempts",
          "Completed At",
          "Benefits Started",
          "Benefits Continued",
          "Benefits Terminated",
          "Error",
        ];
        
        const rows = result.data.map(entry => {
          const summary = entry.resultSummary as any;
          let started = 0, continued = 0, terminated = 0;
          
          if (summary?.actions && Array.isArray(summary.actions)) {
            for (const action of summary.actions) {
              if (action.scanType === "start" && action.eligible) started++;
              else if (action.scanType === "continue") {
                if (action.action === "delete") terminated++;
                else if (action.eligible) continued++;
              }
            }
          }
          
          return [
            entry.workerSiriusId || "",
            entry.workerDisplayName || "",
            entry.workerId || "",
            entry.status,
            entry.triggerSource,
            entry.attempts,
            entry.completedAt ? new Date(entry.completedAt).toISOString() : "",
            started,
            continued,
            terminated,
            entry.lastError || "",
          ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(",");
        });
        
        const csv = [headers.join(","), ...rows].join("\n");
        
        // Build filename with filter info
        let filename = `wmb-scan-${status.year}-${String(status.month).padStart(2, "0")}`;
        if (search) filename += `-search-${search.replace(/[^a-zA-Z0-9]/g, "")}`;
        if (outcome) filename += `-${outcome}`;
        filename += ".csv";
        
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (error: any) {
        console.error("Error exporting WMB scan results:", error);
        res.status(500).json({ message: error.message || "Failed to export scan results" });
      }
    }
  );

  app.post(
    "/api/wmb-scan/enqueue-month",
    requireAuth,
    requireAccess('admin'),
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
    requireAccess('admin'),
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
    requireAccess('admin'),
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
    requireAccess('admin'),
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

  app.post(
    "/api/wmb-scan/cancel/:statusId",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { statusId } = req.params;
        
        // Verify status exists
        const status = await storage.wmbScanQueue.getStatusById(statusId);
        if (!status) {
          return res.status(404).json({ message: "Scan status not found" });
        }
        
        const count = await storage.wmbScanQueue.cancelPendingForStatus(statusId);
        
        res.json({
          message: `Canceled ${count} pending scan entries`,
          canceledCount: count,
        });
      } catch (error: any) {
        console.error("Error canceling scan:", error);
        res.status(500).json({ message: error.message || "Failed to cancel scan" });
      }
    }
  );

  app.post(
    "/api/wmb-scan/resume/:statusId",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { statusId } = req.params;
        
        // Verify status exists
        const status = await storage.wmbScanQueue.getStatusById(statusId);
        if (!status) {
          return res.status(404).json({ message: "Scan status not found" });
        }
        
        const count = await storage.wmbScanQueue.resumeCanceledForStatus(statusId);
        
        res.json({
          message: `Resumed ${count} canceled scan entries`,
          resumedCount: count,
        });
      } catch (error: any) {
        console.error("Error resuming scan:", error);
        res.status(500).json({ message: error.message || "Failed to resume scan" });
      }
    }
  );
}
