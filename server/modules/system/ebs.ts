import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import type { EbsListFilters } from "../../storage/system/ebs";
import { withSystemActor } from "../../middleware/request-context";
import { emitDenormEvent, purgeAfterFromNow } from "../../services/ebs-emit";

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
 * These views are read-only EXCEPT for one write endpoint: an admin-only manual
 * fire (`POST /api/admin/ebs/fire/:id`) that force-re-emits a scheduled event
 * for testing (see its handler for the force-fire semantics). Everything else is
 * strictly read-only: no create / edit / delete, no purging. Routes stay thin;
 * all filtering and paging lives in the storage layer per the
 * storage-encapsulation rule.
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

  // Manually fire (send / resend) a scheduled event by its `ebs_denorm` id.
  // This is a testing tool: it FORCE-fires, deliberately skipping every safety
  // check the pump applies — no `isScheduledEventLive` revalidation and no
  // at-most-once claim — so an already-sent or expired event can be re-fired.
  // Duplicate side effects from non-idempotent listeners are an accepted risk.
  // The emit runs as a SYSTEM actor (acting user cleared) so notifier listeners
  // match the cron's semantics instead of treating the clicking admin as the
  // actor. After emit we force the delivery status to `sent` (overwriting any
  // prior terminal row). 404 when the denorm record is gone (its payload was
  // purged — nothing left to re-fire).
  app.post("/api/admin/ebs/fire/:id", requireAccess("admin"), async (req, res) => {
    try {
      const row = await storage.ebs.getScheduledById(req.params.id);
      if (!row) {
        res.status(404).json({ message: "Scheduled event not found — nothing to fire" });
        return;
      }
      const { denorm } = row;
      const failures = await withSystemActor(() => emitDenormEvent(denorm));
      await storage.ebs.forceSetSent(denorm.uniqueId, purgeAfterFromNow());
      res.json({ failureCount: failures.length });
    } catch (error) {
      console.error("Failed to fire EBS event:", error);
      res.status(500).json({ message: "Failed to fire event" });
    }
  });
}
