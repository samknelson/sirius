import type { Express, RequestHandler, Response } from "express";
import { z } from "zod";
import { assignmentExplorerQuerySchema } from "../../../shared/edls-assignment-explorer";
import { getTodayYmd } from "@shared/utils/date";
import { storage } from "../../../../../server/storage";
import { requireAccess } from "../../../../../server/services/access-policy-evaluator";
import { requireComponent } from "../../../../../server/modules/components";
import { assignmentCsvHeader, assignmentCsvLine, assignmentCsvRow } from "./assignment-explorer-csv";

async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (res.destroyed) throw new Error("Download disconnected");
  if (res.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off("drain", drain); res.off("close", close); res.off("error", error); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new Error("Download disconnected")); };
    const error = (err: Error) => { cleanup(); reject(err); };
    res.once("drain", drain).once("close", close).once("error", error);
  });
}

export function registerEdlsAssignmentExplorerRoutes(app: Express, requireAuth: RequestHandler) {
  for (const exportCsv of [false, true]) {
    app.get(`/api/edls/assignments${exportCsv ? "/export" : ""}`,
      requireAuth, requireComponent("edls"), requireAccess("edls.coordinator"), async (req, res) => {
        res.set("Cache-Control", "private, no-store");
        res.vary("Cookie");
        try {
          const query = assignmentExplorerQuerySchema.parse({ ...req.query, ymd: req.query.ymd ?? getTodayYmd() });
          if (!exportCsv) return res.json(await storage.edlsAssignments.listStatusAssignments(query));
          res.type("text/csv");
          res.attachment(`edls-assignments-${query.ymd}.csv`);
          await writeChunk(res, assignmentCsvLine(assignmentCsvHeader));
          await storage.edlsAssignments.exportStatusAssignments(query, async rows => {
            await writeChunk(res, rows.map(assignmentCsvRow).join(""));
          });
          res.end();
        } catch (error) {
          if (res.headersSent) { res.destroy(); return; }
          if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid assignment filters", errors: error.errors });
          console.error("Failed to read EDLS assignment statuses:", error);
          res.status(500).json({ message: "Failed to read assignment statuses" });
        }
      });
  }
}
