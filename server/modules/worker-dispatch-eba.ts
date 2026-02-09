import type { Express, Request, Response } from "express";
import { createWorkerDispatchEbaStorage, workerDispatchEbaLoggingConfig } from "../storage/worker-dispatch-eba";
import { withStorageLogging } from "../storage/middleware/logging";
import { z } from "zod";
import { requireComponent } from "./components";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const storage = withStorageLogging(
  createWorkerDispatchEbaStorage(),
  workerDispatchEbaLoggingConfig
);

function getValidDateRange(): { min: string; max: string } {
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 29);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { min: fmt(today), max: fmt(maxDate) };
}

const syncDatesSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Each date must be YYYY-MM-DD format")),
});

export function registerWorkerDispatchEbaRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const dispatchComponent = requireComponent("dispatch");
  const ebaComponent = requireComponent("dispatch.eba");

  app.get("/api/worker-dispatch-eba/worker/:workerId", requireAuth, dispatchComponent, ebaComponent, requireAccess('worker.mine', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const entries = await storage.getByWorker(req.params.workerId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching worker EBA entries:", error);
      res.status(500).json({ error: "Failed to fetch availability dates" });
    }
  });

  app.put("/api/worker-dispatch-eba/worker/:workerId/sync", requireAuth, dispatchComponent, ebaComponent, requireAccess('worker.mine', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const validated = syncDatesSchema.parse(req.body);
      
      const uniqueDates = Array.from(new Set(validated.dates));
      
      const { min, max } = getValidDateRange();
      const invalidDates = uniqueDates.filter(d => d < min || d > max);
      if (invalidDates.length > 0) {
        return res.status(400).json({ 
          error: "Invalid dates", 
          details: `Dates must be between ${min} and ${max}. Invalid: ${invalidDates.join(', ')}` 
        });
      }
      
      const result = await storage.syncDatesForWorker(req.params.workerId, uniqueDates);
      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error syncing worker EBA dates:", error);
      res.status(500).json({ error: "Failed to sync availability dates" });
    }
  });
}
