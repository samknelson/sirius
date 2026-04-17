import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const setActiveSchema = z.object({
  active: z.boolean(),
});

export function registerWorkerEdlsRoutes(app: Express, requireAuth: RequireAuth) {
  const edlsComponent = requireComponent("edls");

  app.get(
    "/api/workers/:id/edls",
    requireAuth,
    edlsComponent,
    requireAccess('edls.coordinator', req => req.params.id),
    async (req: Request, res: Response) => {
      const workerId = req.params.id;
      try {
        const row = await storage.workerEdls.getByWorker(workerId);
        if (!row) {
          // Default state when no row exists yet
          res.json({ workerId, active: true, exists: false });
          return;
        }
        res.json({ ...row, exists: true });
      } catch (error) {
        if (isUndefinedTableError(error)) {
          // worker_edls table missing (e.g. fresh deploy before db:push)
          res.json({ workerId, active: true, exists: false, tableMissing: true });
          return;
        }
        console.error("Error fetching worker EDLS state:", error);
        res.status(500).json({ error: "Failed to fetch worker EDLS state" });
      }
    }
  );

  app.put(
    "/api/workers/:id/edls",
    requireAuth,
    edlsComponent,
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
        if (isUndefinedTableError(error)) {
          return res.status(503).json({
            error: "EDLS storage is not available",
            tableMissing: true,
          });
        }
        console.error("Error updating worker EDLS state:", error);
        res.status(500).json({ error: "Failed to update worker EDLS state" });
      }
    }
  );
}

function isUndefinedTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42P01';
}
