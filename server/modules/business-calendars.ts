import type { Express, Request, Response } from "express";
import { IStorage } from "../storage";
import {
  insertBusinessCalendarSchema,
  insertBusinessCalendarManualBydaySchema,
  insertBusinessCalendarManualVacationSchema,
  insertBusinessCalendarManualOpenSchema,
} from "@shared/schema";
import { isValidYmd } from "@shared/utils/date";
import { z } from "zod";
import { isBusinessDay, addBusinessDays, validateRegion } from "../services/business-calendar";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const updateCalendarSchema = insertBusinessCalendarSchema.partial();
const updateVacationSchema = z.object({
  startYmd: z.string().refine(isValidYmd, "must be YYYY-MM-DD").optional(),
  endYmd: z.string().refine(isValidYmd, "must be YYYY-MM-DD").optional(),
});

export function registerBusinessCalendarRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  const adminOnly = requireAccess("admin");

  // ── Calendars ──────────────────────────────────────────────────────

  app.get("/api/business-calendars", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.businessCalendars.getAll());
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch business calendars" });
    }
  });

  // ── Default calendar (must be registered before /:id) ─────────────

  const DEFAULT_CALENDAR_VARIABLE = "business-calendar.default";

  app.get("/api/business-calendars/default", requireAuth, async (_req, res) => {
    try {
      const variable = await storage.variables.getByName(DEFAULT_CALENDAR_VARIABLE);
      const calendarId = typeof variable?.value === "string" ? variable.value : null;
      res.json({ calendarId });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch default business calendar" });
    }
  });

  app.put("/api/business-calendars/default", requireAuth, adminOnly, async (req, res) => {
    try {
      const validated = z.object({ calendarId: z.string().nullable() }).parse(req.body);
      if (validated.calendarId !== null) {
        const calendar = await storage.businessCalendars.get(validated.calendarId);
        if (!calendar) return res.status(404).json({ message: "Business calendar not found" });
      }
      const existing = await storage.variables.getByName(DEFAULT_CALENDAR_VARIABLE);
      if (existing) {
        await storage.variables.update(existing.id, { value: validated.calendarId });
      } else {
        try {
          await storage.variables.create({ name: DEFAULT_CALENDAR_VARIABLE, value: validated.calendarId });
        } catch (createError: any) {
          if (createError?.code !== "23505") throw createError;
          const raced = await storage.variables.getByName(DEFAULT_CALENDAR_VARIABLE);
          if (raced) await storage.variables.update(raced.id, { value: validated.calendarId });
        }
      }
      res.json({ calendarId: validated.calendarId });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to set default business calendar" });
    }
  });

  app.get("/api/business-calendars/:id", requireAuth, async (req, res) => {
    try {
      const full = await storage.businessCalendars.getCalendarWithRules(req.params.id);
      if (!full) return res.status(404).json({ message: "Business calendar not found" });
      res.json(full);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch business calendar" });
    }
  });

  app.post("/api/business-calendars", requireAuth, adminOnly, async (req, res) => {
    try {
      const validated = insertBusinessCalendarSchema.parse(req.body);
      const regionError = validateRegion(validated.data?.region);
      if (regionError) return res.status(400).json({ message: regionError });
      if (validated.siriusId) {
        const existing = await storage.businessCalendars.getBySiriusId(validated.siriusId);
        if (existing) {
          return res.status(400).json({ message: "A business calendar with this Sirius ID already exists" });
        }
      }
      res.status(201).json(await storage.businessCalendars.create(validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to create business calendar" });
    }
  });

  app.put("/api/business-calendars/:id", requireAuth, adminOnly, async (req, res) => {
    try {
      const existing = await storage.businessCalendars.get(req.params.id);
      if (!existing) return res.status(404).json({ message: "Business calendar not found" });
      const validated = updateCalendarSchema.parse(req.body);
      if (validated.data !== undefined) {
        const regionError = validateRegion(validated.data?.region);
        if (regionError) return res.status(400).json({ message: regionError });
      }
      if (validated.siriusId && validated.siriusId !== existing.siriusId) {
        const dup = await storage.businessCalendars.getBySiriusId(validated.siriusId);
        if (dup) {
          return res.status(400).json({ message: "A business calendar with this Sirius ID already exists" });
        }
      }
      res.json(await storage.businessCalendars.update(req.params.id, validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update business calendar" });
    }
  });

  app.delete("/api/business-calendars/:id", requireAuth, adminOnly, async (req, res) => {
    try {
      const deleted = await storage.businessCalendars.delete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Business calendar not found" });
      const defaultVar = await storage.variables.getByName(DEFAULT_CALENDAR_VARIABLE);
      if (defaultVar && defaultVar.value === req.params.id) {
        await storage.variables.update(defaultVar.id, { value: null });
      }
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete business calendar" });
    }
  });

  // ── Computation ────────────────────────────────────────────────────

  app.get("/api/business-calendars/:id/compute", requireAuth, async (req, res) => {
    try {
      const full = await storage.businessCalendars.getCalendarWithRules(req.params.id);
      if (!full) return res.status(404).json({ message: "Business calendar not found" });

      const op = String(req.query.op || "");
      if (op === "isBusinessDay") {
        const ymd = String(req.query.date || "");
        if (!isValidYmd(ymd)) return res.status(400).json({ message: "date must be YYYY-MM-DD" });
        return res.json({ op, date: ymd, isBusinessDay: isBusinessDay(full, ymd) });
      }
      if (op === "addBusinessDays") {
        const start = String(req.query.start || "");
        if (!isValidYmd(start)) return res.status(400).json({ message: "start must be YYYY-MM-DD" });
        const n = Number(req.query.n);
        if (!Number.isInteger(n)) return res.status(400).json({ message: "n must be an integer" });
        return res.json({ op, start, n, result: addBusinessDays(full, start, n) });
      }
      return res.status(400).json({ message: "op must be isBusinessDay or addBusinessDays" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to compute" });
    }
  });

  // ── Manual byday (closed days) ─────────────────────────────────────

  app.get("/api/business-calendars/:id/manual-byday", requireAuth, async (req, res) => {
    try {
      res.json(await storage.businessCalendars.listManualByday(req.params.id));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch closed days" });
    }
  });

  app.post("/api/business-calendars/:id/manual-byday", requireAuth, adminOnly, async (req, res) => {
    try {
      const calendar = await storage.businessCalendars.get(req.params.id);
      if (!calendar) return res.status(404).json({ message: "Business calendar not found" });
      const validated = insertBusinessCalendarManualBydaySchema.parse({
        ...req.body,
        calendarId: req.params.id,
      });
      res.status(201).json(await storage.businessCalendars.createManualByday(validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      if (error?.code === "23505") {
        return res.status(400).json({ message: "That day is already a closed day for this calendar" });
      }
      res.status(500).json({ message: error.message || "Failed to add closed day" });
    }
  });

  app.delete("/api/business-calendars/:id/manual-byday/:rowId", requireAuth, adminOnly, async (req, res) => {
    try {
      const rows = await storage.businessCalendars.listManualByday(req.params.id);
      if (!rows.some((r) => r.id === req.params.rowId)) {
        return res.status(404).json({ message: "Closed day not found" });
      }
      await storage.businessCalendars.deleteManualByday(req.params.rowId);
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete closed day" });
    }
  });

  // ── Manual vacations (closed ranges) ───────────────────────────────

  app.get("/api/business-calendars/:id/manual-vacations", requireAuth, async (req, res) => {
    try {
      res.json(await storage.businessCalendars.listManualVacations(req.params.id));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch vacations" });
    }
  });

  app.post("/api/business-calendars/:id/manual-vacations", requireAuth, adminOnly, async (req, res) => {
    try {
      const calendar = await storage.businessCalendars.get(req.params.id);
      if (!calendar) return res.status(404).json({ message: "Business calendar not found" });
      const validated = insertBusinessCalendarManualVacationSchema.parse({
        ...req.body,
        calendarId: req.params.id,
      });
      res.status(201).json(await storage.businessCalendars.createManualVacation(validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to add vacation" });
    }
  });

  app.put("/api/business-calendars/:id/manual-vacations/:rowId", requireAuth, adminOnly, async (req, res) => {
    try {
      const rows = await storage.businessCalendars.listManualVacations(req.params.id);
      const existing = rows.find((r) => r.id === req.params.rowId);
      if (!existing) return res.status(404).json({ message: "Vacation not found" });
      const validated = updateVacationSchema.parse(req.body);
      const start = validated.startYmd ?? existing.startYmd;
      const end = validated.endYmd ?? existing.endYmd;
      if (start > end) return res.status(400).json({ message: "startYmd must be <= endYmd" });
      res.json(await storage.businessCalendars.updateManualVacation(req.params.rowId, validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      res.status(500).json({ message: error.message || "Failed to update vacation" });
    }
  });

  app.delete("/api/business-calendars/:id/manual-vacations/:rowId", requireAuth, adminOnly, async (req, res) => {
    try {
      const rows = await storage.businessCalendars.listManualVacations(req.params.id);
      if (!rows.some((r) => r.id === req.params.rowId)) {
        return res.status(404).json({ message: "Vacation not found" });
      }
      await storage.businessCalendars.deleteManualVacation(req.params.rowId);
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete vacation" });
    }
  });

  // ── Manual open (forced-open override days) ────────────────────────

  app.get("/api/business-calendars/:id/manual-open", requireAuth, async (req, res) => {
    try {
      res.json(await storage.businessCalendars.listManualOpen(req.params.id));
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch open days" });
    }
  });

  app.post("/api/business-calendars/:id/manual-open", requireAuth, adminOnly, async (req, res) => {
    try {
      const calendar = await storage.businessCalendars.get(req.params.id);
      if (!calendar) return res.status(404).json({ message: "Business calendar not found" });
      const validated = insertBusinessCalendarManualOpenSchema.parse({
        ...req.body,
        calendarId: req.params.id,
      });
      res.status(201).json(await storage.businessCalendars.createManualOpen(validated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      if (error?.code === "23505") {
        return res.status(400).json({ message: "That day is already a forced-open day for this calendar" });
      }
      res.status(500).json({ message: error.message || "Failed to add open day" });
    }
  });

  app.delete("/api/business-calendars/:id/manual-open/:rowId", requireAuth, adminOnly, async (req, res) => {
    try {
      const rows = await storage.businessCalendars.listManualOpen(req.params.id);
      if (!rows.some((r) => r.id === req.params.rowId)) {
        return res.status(404).json({ message: "Open day not found" });
      }
      await storage.businessCalendars.deleteManualOpen(req.params.rowId);
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to delete open day" });
    }
  });
}
