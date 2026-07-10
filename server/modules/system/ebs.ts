import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import type { EbsListFilters } from "../../storage/system/ebs";

/**
 * Read-only admin visibility into the deferred event bus (EBS). Two views:
 *
 * - **Scheduled events** — rows from `ebs_denorm` (one per pending scheduled
 *   event), decorated with the matching `ebs_status` terminal record so you can
 *   see whether a scheduled event has since been sent/expired.
 * - **Sent events** — terminal delivery records from `ebs_status`, decorated
 *   with the originating `ebs_denorm` row when it still exists (`ebs_status` is
 *   decoupled and can outlive its scheduled event, so this is best-effort).
 *
 * Everything is strictly read-only: no create / edit / delete, no manual firing
 * or purging. Routes stay thin; all filtering and paging lives in the storage
 * layer per the storage-encapsulation rule.
 */
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  eventType: z.string().trim().min(1).optional(),
  subjectId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function toFilters(q: z.infer<typeof listQuerySchema>): EbsListFilters {
  return {
    eventType: q.eventType,
    subjectId: q.subjectId,
    from: q.from,
    to: q.to,
  };
}

export function registerEbsInspectionRoutes(app: Express) {
  // Distinct event types for the filter dropdown (shared by both views).
  app.get("/api/admin/ebs/event-types", requireAccess("admin"), async (_req, res) => {
    try {
      const eventTypes = await storage.ebs.distinctEventTypes();
      res.json(eventTypes);
    } catch (error) {
      console.error("Failed to fetch EBS event types:", error);
      res.status(500).json({ message: "Failed to fetch event types" });
    }
  });

  // Paginated scheduled events (ebs_denorm) with their status decoration.
  app.get("/api/admin/ebs/scheduled", requireAccess("admin"), async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid query parameters", errors: parsed.error.flatten() });
      return;
    }
    try {
      const { page, pageSize } = parsed.data;
      const filters = toFilters(parsed.data);
      const [rows, total] = await Promise.all([
        storage.ebs.listScheduled({ page, pageSize, ...filters }),
        storage.ebs.countScheduled(filters),
      ]);
      res.json({ rows, total });
    } catch (error) {
      console.error("Failed to fetch scheduled EBS events:", error);
      res.status(500).json({ message: "Failed to fetch scheduled events" });
    }
  });

  // A single scheduled event by id, with its status counterpart.
  app.get("/api/admin/ebs/scheduled/:id", requireAccess("admin"), async (req, res) => {
    try {
      const row = await storage.ebs.getScheduledById(req.params.id);
      if (!row) {
        res.status(404).json({ message: "Scheduled event not found" });
        return;
      }
      res.json(row);
    } catch (error) {
      console.error("Failed to fetch scheduled EBS event:", error);
      res.status(500).json({ message: "Failed to fetch scheduled event" });
    }
  });

  // Paginated sent/terminal events (ebs_status) with their denorm decoration.
  app.get("/api/admin/ebs/sent", requireAccess("admin"), async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid query parameters", errors: parsed.error.flatten() });
      return;
    }
    try {
      const { page, pageSize } = parsed.data;
      const filters = toFilters(parsed.data);
      const [rows, total] = await Promise.all([
        storage.ebs.listSent({ page, pageSize, ...filters }),
        storage.ebs.countSent(filters),
      ]);
      res.json({ rows, total });
    } catch (error) {
      console.error("Failed to fetch sent EBS events:", error);
      res.status(500).json({ message: "Failed to fetch sent events" });
    }
  });

  // A single sent/terminal record by id, with its denorm counterpart (if present).
  app.get("/api/admin/ebs/sent/:id", requireAccess("admin"), async (req, res) => {
    try {
      const row = await storage.ebs.getSentById(req.params.id);
      if (!row) {
        res.status(404).json({ message: "Sent event not found" });
        return;
      }
      res.json(row);
    } catch (error) {
      console.error("Failed to fetch sent EBS event:", error);
      res.status(500).json({ message: "Failed to fetch sent event" });
    }
  });
}
