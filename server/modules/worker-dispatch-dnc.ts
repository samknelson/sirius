import type { Express, Request, Response, NextFunction } from "express";
import { insertWorkerDispatchDncSchema } from "@shared/schema";
import { createWorkerDispatchDncStorage, workerDispatchDncLoggingConfig } from "../storage/worker-dispatch-dnc";
import { withStorageLogging } from "../storage/middleware/logging";
import { storage as mainStorage } from "../storage";
import { z } from "zod";
import { requireComponent } from "./components";
import type { RequireAccessOptions } from "../services/access-policy-evaluator";

type RequireAccess = (
  policy: string,
  getEntityIdOrOptions?: ((req: Request) => string | Promise<string | undefined> | undefined) | RequireAccessOptions
) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const storage = withStorageLogging(
  createWorkerDispatchDncStorage(),
  workerDispatchDncLoggingConfig
);

async function enrichWithEmployer(entries: any[]) {
  if (entries.length === 0) return entries;
  
  const employerIds = Array.from(new Set(entries.map(e => e.employerId)));
  const employerRecords = await mainStorage.employers.getByIds(employerIds);
  
  const employerMap = new Map(employerRecords.map(e => [e.id, e]));
  
  return entries.map(entry => ({
    ...entry,
    employer: employerMap.get(entry.employerId) || null
  }));
}

export function registerWorkerDispatchDncRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const dispatchComponent = requireComponent("dispatch");

  app.get("/api/worker-dispatch-dnc/worker/:workerId", requireAuth, dispatchComponent, requireAccess('worker.view', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const entries = await storage.getByWorker(req.params.workerId);
      const enriched = await enrichWithEmployer(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching worker DNC entries:", error);
      res.status(500).json({ error: "Failed to fetch DNC entries" });
    }
  });

  app.get("/api/worker-dispatch-dnc/employer/:employerId", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const entries = await storage.getByEmployer(req.params.employerId);
      const enriched = await enrichWithEmployer(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching employer DNC entries:", error);
      res.status(500).json({ error: "Failed to fetch DNC entries" });
    }
  });

  // Get single DNC entry by ID - load first for 404, then check access
  app.get("/api/worker-dispatch-dnc/:id", requireAuth, dispatchComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await storage.get(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "DNC entry not found" });
      }
      (req as any).dncEntry = Object.freeze({ ...entry });
      next();
    } catch (error) {
      console.error("Error fetching DNC entry:", error);
      res.status(500).json({ error: "Failed to fetch DNC entry" });
    }
  }, requireAccess('worker.dispatch.dnc.view', {
    getEntityId: req => req.params.id,
    getEntityData: req => (req as any).dncEntry
  }), async (req: Request, res: Response) => {
    try {
      const entry = (req as any).dncEntry;
      const [enriched] = await enrichWithEmployer([entry]);
      res.json(enriched);
    } catch (error) {
      console.error("Error enriching DNC entry:", error);
      res.status(500).json({ error: "Failed to fetch DNC entry" });
    }
  });

  // Create DNC entry - uses DNC edit policy with entityData from validated body
  app.post("/api/worker-dispatch-dnc", requireAuth, dispatchComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = insertWorkerDispatchDncSchema.parse(req.body);
      (req as any).validatedBody = Object.freeze({ ...validated });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      return res.status(400).json({ error: "Invalid request body" });
    }
  }, requireAccess('worker.dispatch.dnc.edit', {
    getEntityData: req => (req as any).validatedBody
  }), async (req: Request, res: Response) => {
    try {
      const validated = (req as any).validatedBody;
      const entry = await storage.create(validated);
      const [enriched] = await enrichWithEmployer([entry]);
      res.status(201).json(enriched);
    } catch (error) {
      console.error("Error creating DNC entry:", error);
      res.status(500).json({ error: "Failed to create DNC entry" });
    }
  });

  // Update DNC entry - load existing, merge with request body, check policy against merged data
  app.put("/api/worker-dispatch-dnc/:id", requireAuth, dispatchComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await storage.get(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "DNC entry not found" });
      }
      const validated = insertWorkerDispatchDncSchema.partial().parse(req.body);
      // Merge existing record with updates - policy checks resulting state
      const mergedData = { ...entry, ...validated };
      (req as any).dncEntry = Object.freeze({ ...entry });
      (req as any).mergedData = Object.freeze(mergedData);
      (req as any).validatedBody = Object.freeze({ ...validated });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error fetching DNC entry:", error);
      res.status(500).json({ error: "Failed to fetch DNC entry" });
    }
  }, requireAccess('worker.dispatch.dnc.edit', {
    getEntityId: req => req.params.id,
    getEntityData: req => (req as any).mergedData // Check policy against resulting state
  }), async (req: Request, res: Response) => {
    try {
      const validated = (req as any).validatedBody;
      const entry = await storage.update(req.params.id, validated);
      if (!entry) {
        return res.status(404).json({ error: "DNC entry not found" });
      }
      const [enriched] = await enrichWithEmployer([entry]);
      res.json(enriched);
    } catch (error) {
      console.error("Error updating DNC entry:", error);
      res.status(500).json({ error: "Failed to update DNC entry" });
    }
  });

  // Delete DNC entry - load first for 404 and access check
  app.delete("/api/worker-dispatch-dnc/:id", requireAuth, dispatchComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await storage.get(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "DNC entry not found" });
      }
      (req as any).dncEntry = Object.freeze({ ...entry });
      next();
    } catch (error) {
      console.error("Error fetching DNC entry:", error);
      res.status(500).json({ error: "Failed to fetch DNC entry" });
    }
  }, requireAccess('worker.dispatch.dnc.edit', {
    getEntityId: req => req.params.id,
    getEntityData: req => (req as any).dncEntry
  }), async (req: Request, res: Response) => {
    try {
      const deleted = await storage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "DNC entry not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting DNC entry:", error);
      res.status(500).json({ error: "Failed to delete DNC entry" });
    }
  });
}
