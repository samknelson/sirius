import { createHash } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../../storage";
import { runInTransaction } from "../../../storage/transaction-context";
import {
  CREW_LEADS_TRANSFER_TYPE,
  planCrewLeadsImport,
  type CrewLeadsImportResult,
} from "../../../../shared/freemanCrewleadsTransfer";

const inputSchema = z.object({
  text: z.string().max(2_000_000),
  mode: z.enum(["merge", "replace"]),
  token: z.string().optional(),
  confirmDeletion: z.boolean().optional(),
});

export function registerCrewLeadsTransferRoutes(
  app: Express,
  readGates: RequestHandler[],
  writeGates: RequestHandler[],
) {
  const base = "/api/sitespecific/freeman/crewleads";
  const crewleads = storage.freemanCrewleads;
  app.get(`${base}/export`, ...readGates, async (_req, res) => {
    res.set("Cache-Control", "private, no-store");
    try {
      const records = (await crewleads.getAll()).map(({ name, siriusId }) => ({ name, siriusId }));
      res.json({ type: CREW_LEADS_TRANSFER_TYPE, exportedAt: new Date().toISOString(), records });
    } catch {
      res.status(500).json({ message: "Could not export crew leads." });
    }
  });
  for (const operation of ["preview", "apply"] as const) {
    app.post(`${base}/import/${operation}`, ...writeGates, async (req, res) => {
      res.set("Cache-Control", "private, no-store");
      const parsed = inputSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid import request.", errors: parsed.error.flatten() });
      const { text, mode, token: expectedToken, confirmDeletion } = parsed.data;
      try {
        const result = await runInTransaction(async (): Promise<CrewLeadsImportResult> => {
          // Serialize apply against every writer, not just other imports.
          if (operation === "apply") await crewleads.lockForImport();
          const rows = await crewleads.getAll();
          const plan = planCrewLeadsImport(text, mode, rows);
          const token = createHash("sha256").update(JSON.stringify({
            text, mode,
            rows: rows.map(({ id, siriusId, name }) => ({ id, siriusId, name }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          })).digest("hex");
          const response: CrewLeadsImportResult = { ...plan, token, applied: false };
          if (operation === "preview" || plan.errors.length) return response;
          if (expectedToken !== token) return {
            ...response, stale: true,
            errors: [{ position: null, name: null, message: "The list or input has changed. Preview again and confirm the new changes." }],
          };
          if (plan.summary.delete > 0 && !confirmDeletion) return {
            ...response,
            errors: [{ position: null, name: null, message: "Confirm the previewed deletions before applying." }],
          };
          for (const item of plan.items) {
            if (item.action === "create") await crewleads.create({ name: item.name, siriusId: item.siriusId });
            if (item.action === "update" && item.existingId) {
              if (!await crewleads.update(item.existingId, { name: item.name })) throw new Error("Record disappeared");
            }
            if (item.action === "delete" && item.existingId) {
              if (!await crewleads.delete(item.existingId)) throw new Error("Record disappeared");
            }
          }
          return { ...response, applied: true };
        });
        res.json(result);
      } catch {
        res.status(500).json({ message: "The import could not be applied. No records were changed. Preview again before retrying." });
      }
    });
  }
}
