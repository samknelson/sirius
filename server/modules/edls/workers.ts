import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { isWorkerEdlsAvailable } from "./capability";
import { requireComponent } from "../components";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const setActiveSchema = z.object({
  active: z.boolean(),
});

async function requireWorkerEdlsCapability(req: Request, res: Response, next: NextFunction) {
  const available = await isWorkerEdlsAvailable();
  if (!available) {
    res.status(404).json({ error: "EDLS feature not available", capability: "workerEdls" });
    return;
  }
  next();
}

export function registerWorkerEdlsRoutes(app: Express, requireAuth: RequireAuth) {
  const edlsComponent = requireComponent("edls");

  app.get(
    "/api/workers/:id/edls",
    requireAuth,
    edlsComponent,
    requireWorkerEdlsCapability,
    requireAccess('edls.coordinator', req => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const workerId = req.params.id;
        const row = await storage.workerEdls.getByWorker(workerId);
        if (!row) {
          // Default state when no row exists yet
          res.json({ workerId, active: true, exists: false });
          return;
        }
        res.json({ ...row, exists: true });
      } catch (error) {
        console.error("Error fetching worker EDLS state:", error);
        res.status(500).json({ error: "Failed to fetch worker EDLS state" });
      }
    }
  );

  app.put(
    "/api/workers/:id/edls",
    requireAuth,
    edlsComponent,
    requireWorkerEdlsCapability,
    requireAccess('edls.coordinator', req => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const { active } = setActiveSchema.parse(req.body);
        const updated = await storage.workerEdls.setActive(req.params.id, active);
        res.json({ ...updated, exists: true });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid data", details: error.errors });
        }
        console.error("Error updating worker EDLS state:", error);
        res.status(500).json({ error: "Failed to update worker EDLS state" });
      }
    }
  );
}
