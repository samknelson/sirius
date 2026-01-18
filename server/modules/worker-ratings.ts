import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { requireComponent } from "./components";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;
type RequirePermission = (permission: string) => (req: Request, res: Response, next: () => void) => void;

const upsertWorkerRatingSchema = z.object({
  ratingId: z.string(),
  value: z.number().min(0).max(4).nullable(),
});

export function registerWorkerRatingsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  requirePermission: RequirePermission
) {
  const ratingsComponent = requireComponent("worker.ratings");

  app.get("/api/worker-ratings/worker/:workerId", requireAuth, ratingsComponent, requireAccess('worker.view', (req) => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const ratings = await storage.workerRatings.getByWorker(req.params.workerId);
      res.json(ratings);
    } catch (error) {
      console.error("Error fetching worker ratings:", error);
      res.status(500).json({ error: "Failed to fetch worker ratings" });
    }
  });

  app.post("/api/worker-ratings/worker/:workerId", requireAuth, ratingsComponent, requirePermission('staff'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = upsertWorkerRatingSchema.parse(req.body);
      (req as any).validatedRating = validated;
      return requireAccess('worker.view', () => req.params.workerId)(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error validating rating data:", error);
      res.status(500).json({ error: "Failed to validate rating data" });
    }
  }, async (req: Request, res: Response) => {
    try {
      const { ratingId, value } = (req as any).validatedRating;
      const workerId = req.params.workerId;
      
      const result = await storage.workerRatings.upsert(workerId, ratingId, value);
      res.json({ success: true, rating: result });
    } catch (error) {
      console.error("Error saving worker rating:", error);
      res.status(500).json({ error: "Failed to save worker rating" });
    }
  });
}
