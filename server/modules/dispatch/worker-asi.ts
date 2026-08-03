import type { Express, Request, Response } from "express";
import { createWorkerDispatchAsiStorage, workerDispatchAsiLoggingConfig } from "../../storage/dispatch/worker-asi";
import { withStorageLogging } from "../../storage/middleware/logging";
import { z } from "zod";
import { requireComponent } from "../components";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const storage = withStorageLogging(
  createWorkerDispatchAsiStorage(),
  workerDispatchAsiLoggingConfig
);

const updateAsiSchema = z.object({
  asi: z.boolean(),
});

export function registerWorkerDispatchAsiRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const dispatchComponent = requireComponent("dispatch");
  const asiComponent = requireComponent("dispatch.asi");

  app.get("/api/worker-dispatch-asi/worker/:workerId", requireAuth, dispatchComponent, asiComponent, requireAccess('worker.dispatch.asi', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const entry = await storage.getByWorker(req.params.workerId);
      res.json({ asi: entry?.asi ?? false });
    } catch (error) {
      console.error("Error fetching worker auto sign-in:", error);
      res.status(500).json({ error: "Failed to fetch auto sign-in setting" });
    }
  });

  app.put("/api/worker-dispatch-asi/worker/:workerId", requireAuth, dispatchComponent, asiComponent, requireAccess('worker.dispatch.asi', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const { asi } = updateAsiSchema.parse(req.body);
      const result = await storage.upsertByWorker(req.params.workerId, asi);
      res.json({ asi: result.asi });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating worker auto sign-in:", error);
      res.status(500).json({ error: "Failed to update auto sign-in setting" });
    }
  });
}
