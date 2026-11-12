import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { buildContext, requireAccess } from "../../services/access-policy-evaluator";
import { presentAuthorizedRecordGoSource } from "../../services/record-go-access";
import { logger } from "../../logger";
import type { WorkerBadgeListItem } from "@shared/schema/worker/badges/schema";

type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;

export function registerWorkerBadgesRoutes(app: Express, requireAuth: RequireAuth): void {
  app.get("/api/workers/:id/badges", requireAuth, requireComponent("worker.badges"),
    requireAccess("worker.view", req => req.params.id), async (req, res) => {
      // Sources are viewer-specific even when the badge rows are not.
      res.setHeader("Cache-Control", "private, no-store");
      res.vary("Cookie");
      try {
        if (!(await storage.workers.getWorker(req.params.id))) {
          return res.status(404).json({ message: "Worker not found" });
        }
        const { user } = await buildContext(req);
        const rows = await storage.workerBadgesDenorm.getByWorker(req.params.id);
        const result: WorkerBadgeListItem[] = [];
        const sources = new Map<string, WorkerBadgeListItem["source"]>();
        for (const { origin, grantedTimestamp, revokedTimestamp, ...badge } of rows) {
          let source: WorkerBadgeListItem["source"] = null;
          if (origin) {
            const key = JSON.stringify([origin.entityType, origin.entityId]);
            if (sources.has(key)) source = sources.get(key)!;
            else {
              try {
                source = await presentAuthorizedRecordGoSource(user, origin.entityType, origin.entityId);
              } catch {
                logger.warn("Badge source resolution unavailable", { service: "worker-badges", badgeId: badge.id });
              }
              sources.set(key, source);
            }
          }
          result.push({
            ...badge, grantedTimestamp: grantedTimestamp?.toISOString() ?? null,
            revokedTimestamp: revokedTimestamp?.toISOString() ?? null, source,
          });
        }
        res.json(result);
      } catch {
        logger.error("Failed to read worker badges", { service: "worker-badges" });
        res.status(500).json({ message: "Failed to load badges" });
      }
    });
}
