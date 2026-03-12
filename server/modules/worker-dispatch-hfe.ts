import type { Express, Request, Response, NextFunction } from "express";
import { insertWorkerDispatchHfeSchema } from "@shared/schema";
import { createWorkerDispatchHfeStorage, workerDispatchHfeLoggingConfig } from "../storage/worker-dispatch-hfe";
import { withStorageLogging } from "../storage/middleware/logging";
import { storage as mainStorage } from "../storage";
import { z } from "zod";
import { requireComponent } from "./components";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const storage = withStorageLogging(
  createWorkerDispatchHfeStorage(),
  workerDispatchHfeLoggingConfig
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

export function registerWorkerDispatchHfeRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const dispatchComponent = requireComponent("dispatch");
  const hfeComponent = requireComponent("dispatch.hfe");

  app.get("/api/worker-dispatch-hfe/worker/:workerId", requireAuth, dispatchComponent, hfeComponent, requireAccess('worker.view', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const entries = await storage.getByWorker(req.params.workerId);
      const enriched = await enrichWithEmployer(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching worker HFE entries:", error);
      res.status(500).json({ error: "Failed to fetch HFE entries" });
    }
  });

  app.get("/api/worker-dispatch-hfe/employer/:employerId", requireAuth, dispatchComponent, hfeComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const entries = await storage.getByEmployer(req.params.employerId);
      const enriched = await enrichWithEmployer(entries);
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching employer HFE entries:", error);
      res.status(500).json({ error: "Failed to fetch HFE entries" });
    }
  });

  app.get("/api/worker-dispatch-hfe/:id", requireAuth, dispatchComponent, hfeComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await storage.get(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "HFE entry not found" });
      }
      (req as any).hfeEntry = Object.freeze({ ...entry });
      next();
    } catch (error) {
      console.error("Error fetching HFE entry:", error);
      res.status(500).json({ error: "Failed to fetch HFE entry" });
    }
  }, requireAccess('worker.view', req => (req as any).hfeEntry?.workerId), async (req: Request, res: Response) => {
    try {
      const entry = (req as any).hfeEntry;
      const [enriched] = await enrichWithEmployer([entry]);
      res.json(enriched);
    } catch (error) {
      console.error("Error enriching HFE entry:", error);
      res.status(500).json({ error: "Failed to fetch HFE entry" });
    }
  });

  app.post("/api/worker-dispatch-hfe", requireAuth, dispatchComponent, hfeComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = insertWorkerDispatchHfeSchema.parse(req.body);
      (req as any).validatedBody = Object.freeze({ ...validated });
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      return res.status(400).json({ error: "Invalid request body" });
    }
  }, requireAccess('worker.edit', req => (req as any).validatedBody?.workerId), async (req: Request, res: Response) => {
    try {
      const validated = (req as any).validatedBody;
      const entry = await storage.create(validated);
      const [enriched] = await enrichWithEmployer([entry]);
      res.status(201).json(enriched);
    } catch (error) {
      console.error("Error creating HFE entry:", error);
      res.status(500).json({ error: "Failed to create HFE entry" });
    }
  });

  app.put("/api/worker-dispatch-hfe/:id", requireAuth, dispatchComponent, hfeComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await storage.get(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "HFE entry not found" });
      }
      (req as any).hfeEntry = Object.freeze({ ...entry });
      next();
    } catch (error) {
      console.error("Error fetching HFE entry:", error);
      res.status(500).json({ error: "Failed to fetch HFE entry" });
    }
  }, requireAccess('worker.edit', req => (req as any).hfeEntry?.workerId), async (req: Request, res: Response) => {
    try {
      const validated = insertWorkerDispatchHfeSchema.partial().parse(req.body);
      const entry = await storage.update(req.params.id, validated);
      if (!entry) {
        return res.status(404).json({ error: "HFE entry not found" });
      }
      const [enriched] = await enrichWithEmployer([entry]);
      res.json(enriched);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating HFE entry:", error);
      res.status(500).json({ error: "Failed to update HFE entry" });
    }
  });

  app.delete("/api/worker-dispatch-hfe/:id", requireAuth, dispatchComponent, hfeComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await storage.get(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: "HFE entry not found" });
      }
      (req as any).hfeEntry = Object.freeze({ ...entry });
      next();
    } catch (error) {
      console.error("Error fetching HFE entry:", error);
      res.status(500).json({ error: "Failed to fetch HFE entry" });
    }
  }, requireAccess('worker.edit', req => (req as any).hfeEntry?.workerId), async (req: Request, res: Response) => {
    try {
      const deleted = await storage.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "HFE entry not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting HFE entry:", error);
      res.status(500).json({ error: "Failed to delete HFE entry" });
    }
  });
}
