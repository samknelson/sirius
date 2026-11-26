import type { Express } from "express";
import { requireAccess } from "../../../../server/services/access-policy-evaluator";
import { requireComponent } from "../../../../server/modules/components";
import { eligibleWorkersSql } from "../storage/eligible-workers";

export function registerSqlRoutes(app: Express) {
  app.get("/api/dispatch-jobs/:id/eligible-workers-sql",
    requireComponent("dispatch"), requireAccess("admin"), requireComponent("debug"),
    async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
        const offset = parseInt(req.query.offset as string) || 0;
        const filters: { siriusId?: number; name?: string } = {};
        if (req.query.siriusId) {
          const id = parseInt(req.query.siriusId as string);
          if (!isNaN(id)) filters.siriusId = id;
        }
        if (typeof req.query.name === "string" && req.query.name.trim()) filters.name = req.query.name.trim();
        const result = await eligibleWorkersSql(req.params.id, limit, offset, filters);
        if (!result) { res.status(404).json({ message: "Job not found" }); return; }
        res.json(result);
      } catch {
        res.status(500).json({ message: "Failed to fetch eligible workers SQL" });
      }
    });
}
