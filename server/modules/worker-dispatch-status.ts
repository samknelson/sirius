import type { Express, Request, Response, NextFunction } from "express";
import { insertWorkerDispatchStatusSchema, workerDispatchStatusEnum } from "@shared/schema";
import { createWorkerDispatchStatusStorage, workerDispatchStatusLoggingConfig } from "../storage/worker-dispatch-status";
import { withStorageLogging } from "../storage/middleware/logging";
import { requireComponent } from "./components";
import { z } from "zod";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const storage = withStorageLogging(
  createWorkerDispatchStatusStorage(),
  workerDispatchStatusLoggingConfig
);

export function registerWorkerDispatchStatusRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const dispatchComponent = requireComponent("dispatch");

  // Worker-accessible route - workers can view their own status
  app.get("/api/worker-dispatch-status/worker/:workerId", requireAuth, dispatchComponent, requireAccess('worker.view', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const status = await storage.getByWorker(req.params.workerId);
      res.json(status || null);
    } catch (error) {
      console.error("Error fetching worker dispatch status:", error);
      res.status(500).json({ error: "Failed to fetch worker dispatch status" });
    }
  });

  // Get by ID - fetch once, freeze, check worker.view
  app.get("/api/worker-dispatch-status/:id", requireAuth, dispatchComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await storage.get(req.params.id);
      if (!status) {
        return res.status(404).json({ error: "Worker dispatch status not found" });
      }
      (req as any).statusEntry = Object.freeze({ ...status });
      next();
    } catch (error) {
      console.error("Error fetching worker dispatch status:", error);
      res.status(500).json({ error: "Failed to fetch worker dispatch status" });
    }
  }, requireAccess('worker.view', req => (req as any).statusEntry?.workerId), async (req: Request, res: Response) => {
    try {
      const status = (req as any).statusEntry;
      res.json(status);
    } catch (error) {
      console.error("Error returning worker dispatch status:", error);
      res.status(500).json({ error: "Failed to fetch worker dispatch status" });
    }
  });

  // Admin routes - require staff permission
  app.post("/api/worker-dispatch-status", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = insertWorkerDispatchStatusSchema.parse(req.body);
      const status = await storage.create(validated);
      res.status(201).json(status);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error creating worker dispatch status:", error);
      res.status(500).json({ error: "Failed to create worker dispatch status" });
    }
  });

  app.put("/api/worker-dispatch-status/worker/:workerId/status", requireAuth, dispatchComponent, requireAccess('worker.mine', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const schema = z.object({ status: z.enum(workerDispatchStatusEnum) });
      const { status: newStatus } = schema.parse(req.body);
      const result = await storage.upsertByWorker(req.params.workerId, { status: newStatus });
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating worker dispatch status:", error);
      res.status(500).json({ error: "Failed to update worker dispatch status" });
    }
  });

  app.put("/api/worker-dispatch-status/worker/:workerId/seniority-date", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const schema = z.object({ seniorityDate: z.coerce.date().nullable() });
      const { seniorityDate } = schema.parse(req.body);
      const result = await storage.upsertByWorker(req.params.workerId, { seniorityDate });
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating worker dispatch seniority date:", error);
      res.status(500).json({ error: "Failed to update worker dispatch seniority date" });
    }
  });

  app.put("/api/worker-dispatch-status/worker/:workerId", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = insertWorkerDispatchStatusSchema.partial().parse(req.body);
      const status = await storage.upsertByWorker(req.params.workerId, validated);
      res.json(status);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating worker dispatch status:", error);
      res.status(500).json({ error: "Failed to update worker dispatch status" });
    }
  });

  app.put("/api/worker-dispatch-status/:id", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = insertWorkerDispatchStatusSchema.partial().parse(req.body);
      const status = await storage.update(req.params.id, validated);
      if (!status) {
        return res.status(404).json({ error: "Worker dispatch status not found" });
      }
      res.json(status);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating worker dispatch status:", error);
      res.status(500).json({ error: "Failed to update worker dispatch status" });
    }
  });

  app.delete("/api/worker-dispatch-status/:id", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const deleted = await storage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Worker dispatch status not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting worker dispatch status:", error);
      res.status(500).json({ error: "Failed to delete worker dispatch status" });
    }
  });
}
