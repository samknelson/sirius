import type { Express } from "express";
import { storage } from "../../../../server/storage";
import { requireAccess } from "../../../../server/services/access-policy-evaluator";
import { requireComponent } from "../../../../server/modules/components";
import { sessionHistoryPagingSchema } from "../../shared/session-history";

export function registerSessionHistoryRoutes(app: Express): void {
  app.get("/api/admin/users/:id/session_history",
    requireAccess('admin'), requireComponent('system.session_history'), async (req, res) => {
      // Reject arrays, objects, fractions, scientific notation, and trailing junk.
      const positiveInteger = (value: unknown): number | undefined =>
        value === undefined ? undefined :
          typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
      const paging = sessionHistoryPagingSchema.safeParse({
        page: positiveInteger(req.query.page),
        pageSize: positiveInteger(req.query.pageSize),
      });
      if (!paging.success) {
        return res.status(400).json({ message: "Invalid pagination: page must be a positive integer and pageSize must be between 1 and 100" });
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.vary("Cookie");
      try {
        if (!await storage.users.getUser(req.params.id)) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(await storage.sessionHistory.getUserPage(req.params.id, paging.data));
      } catch {
        // Database errors can carry raw session identifiers in query parameters.
        res.status(500).json({ message: "Failed to fetch session history" });
      }
    });
}
