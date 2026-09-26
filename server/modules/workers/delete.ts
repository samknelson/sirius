import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "../../storage";

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;
type PermissionMiddleware = (permission: string) => Middleware;

export function registerWorkerDeleteRoute(
  app: Express,
  requireAuth: Middleware,
  requirePermissionOrAdmin: PermissionMiddleware,
): void {
  app.delete(
    "/api/workers/:id",
    requireAuth,
    requirePermissionOrAdmin("worker.delete"),
    async (req, res) => {
      try {
        const { id } = req.params;
        const deleted = await storage.workers.deleteWorker(id);

        if (!deleted) {
          res.status(404).json({ message: "Worker not found" });
          return;
        }

        res.status(204).send();
      } catch (error) {
        res.status(500).json({ message: "Failed to delete worker" });
      }
    },
  );
}