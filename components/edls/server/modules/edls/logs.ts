import type { Express, RequestHandler } from "express";
import { storage } from "../../../../../server/storage";
import { requireComponent } from "../../../../../server/modules/components";
import { requireAccess } from "../../../../../server/services/access-policy-evaluator";

export function registerEdlsLogsRoutes(app: Express, requireAuth: RequestHandler) {
  app.get("/api/edls/sheets/:sheetId/logs", requireAuth, requireComponent("edls"), requireAccess("edls.any"), async (req, res) => {
    try {
      const { sheetId } = req.params;
      const { module, operation, startDate, endDate } = req.query;
      if (!await storage.edlsSheets.get(sheetId)) return res.status(404).json({ message: "Sheet not found" });
      res.json(await storage.logs.getLogsByHostEntityIds({
        hostEntityIds: [sheetId],
        module: typeof module === "string" ? module : undefined,
        operation: typeof operation === "string" ? operation : undefined,
        startDate: typeof startDate === "string" ? startDate : undefined,
        endDate: typeof endDate === "string" ? endDate : undefined,
      }));
    } catch (error) {
      console.error("Failed to fetch EDLS sheet logs:", error);
      res.status(500).json({ message: "Failed to fetch sheet logs" });
    }
  });
}
