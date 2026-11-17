import type { Express, RequestHandler } from "express";
import { processPagingSchema } from "@shared/processes";
import { storage } from "../../storage";

export function registerProcessRoutes(app: Express, requireAccess: (policy: string) => RequestHandler) {
  app.get("/api/processes", requireAccess("admin"), async (req, res) => {
    const paging = processPagingSchema.safeParse(req.query);
    if (!paging.success) {
      res.status(400).json({ error: "Invalid pagination: page must be 1–1000000 and pageSize 1–100." });
      return;
    }
    res.set("Cache-Control", "private, no-store");
    try {
      res.json(await storage.processes.getPage(paging.data));
    } catch {
      res.status(503).json({ error: "Process inventory is unavailable." });
    }
  });
}
