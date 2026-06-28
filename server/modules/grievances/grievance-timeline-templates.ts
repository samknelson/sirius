import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { GRIEVANCE_TIMELINE_DAY_TYPES } from "@shared/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (
  policy: any,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const createTemplateSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().min(1).nullish(),
});

const updateTemplateSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const stepBodySchema = z.object({
  fromStatuses: z.array(z.string().uuid("A valid status is required")).min(1, "Select at least one from status"),
  toStatuses: z.array(z.string().uuid("A valid status is required")).min(1, "Select at least one to status"),
  stepId: z.string().uuid("A valid step is required"),
  days: z.number().int().min(0, "Days must be zero or greater"),
  dayType: z.enum(GRIEVANCE_TIMELINE_DAY_TYPES),
});

export function registerGrievanceTimelineTemplateRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: PolicyMiddleware,
) {
  const gate = [requireAuth, requireComponent("grievance"), requireAccess("admin")] as const;

  app.get("/api/grievance-timeline-templates", ...gate, async (_req, res) => {
    try {
      const records = await storage.grievanceTimelineTemplates.list();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch grievance timeline templates:", error);
      res.status(500).json({ message: "Failed to fetch timeline templates" });
    }
  });

  app.post("/api/grievance-timeline-templates", ...gate, async (req, res) => {
    try {
      const parsed = createTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const created = await storage.grievanceTimelineTemplates.create({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("Failed to create grievance timeline template:", error);
      res.status(500).json({ message: "Failed to create timeline template" });
    }
  });

  app.get("/api/grievance-timeline-templates/:id", ...gate, async (req, res) => {
    try {
      const record = await storage.grievanceTimelineTemplates.getWithSteps(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Timeline template not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch grievance timeline template:", error);
      res.status(500).json({ message: "Failed to fetch timeline template" });
    }
  });

  app.patch("/api/grievance-timeline-templates/:id", ...gate, async (req, res) => {
    try {
      const parsed = updateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const existing = await storage.grievanceTimelineTemplates.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Timeline template not found" });
      }
      const data: Record<string, unknown> = {};
      if (parsed.data.title !== undefined) data.title = parsed.data.title;
      if (parsed.data.description !== undefined) data.description = parsed.data.description ?? null;

      const updated = await storage.grievanceTimelineTemplates.update(req.params.id, data);
      res.json(updated);
    } catch (error) {
      console.error("Failed to update grievance timeline template:", error);
      res.status(500).json({ message: "Failed to update timeline template" });
    }
  });

  app.delete("/api/grievance-timeline-templates/:id", ...gate, async (req, res) => {
    try {
      const deleted = await storage.grievanceTimelineTemplates.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Timeline template not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Failed to delete grievance timeline template:", error);
      res.status(500).json({ message: "Failed to delete timeline template" });
    }
  });

  // --- Steps (nested under a template) ---

  app.get("/api/grievance-timeline-templates/:id/steps", ...gate, async (req, res) => {
    try {
      const template = await storage.grievanceTimelineTemplates.get(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Timeline template not found" });
      }
      const steps = await storage.grievanceTimelineTemplates.listSteps(req.params.id);
      res.json(steps);
    } catch (error) {
      console.error("Failed to fetch grievance timeline template steps:", error);
      res.status(500).json({ message: "Failed to fetch timeline steps" });
    }
  });

  app.post("/api/grievance-timeline-templates/:id/steps", ...gate, async (req, res) => {
    try {
      const parsed = stepBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const template = await storage.grievanceTimelineTemplates.get(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Timeline template not found" });
      }

      const validationError = await validateStepReferences(parsed.data, res);
      if (validationError) return validationError;

      const created = await storage.grievanceTimelineTemplates.createStep({
        templateId: req.params.id,
        fromStatuses: parsed.data.fromStatuses,
        toStatuses: parsed.data.toStatuses,
        stepId: parsed.data.stepId,
        days: parsed.data.days,
        dayType: parsed.data.dayType,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("Failed to create grievance timeline template step:", error);
      res.status(500).json({ message: "Failed to create timeline step" });
    }
  });

  app.patch("/api/grievance-timeline-templates/:id/steps/:stepRowId", ...gate, async (req, res) => {
    try {
      const parsed = stepBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const existing = await storage.grievanceTimelineTemplates.getStep(
        req.params.id,
        req.params.stepRowId,
      );
      if (!existing) {
        return res.status(404).json({ message: "Timeline step not found" });
      }

      const validationError = await validateStepReferences(parsed.data, res);
      if (validationError) return validationError;

      const updated = await storage.grievanceTimelineTemplates.updateStep(
        req.params.id,
        req.params.stepRowId,
        {
          fromStatuses: parsed.data.fromStatuses,
          toStatuses: parsed.data.toStatuses,
          stepId: parsed.data.stepId,
          days: parsed.data.days,
          dayType: parsed.data.dayType,
        },
      );
      res.json(updated);
    } catch (error) {
      console.error("Failed to update grievance timeline template step:", error);
      res.status(500).json({ message: "Failed to update timeline step" });
    }
  });

  app.delete("/api/grievance-timeline-templates/:id/steps/:stepRowId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievanceTimelineTemplates.deleteStep(
        req.params.id,
        req.params.stepRowId,
      );
      if (!removed) {
        return res.status(404).json({ message: "Timeline step not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Failed to delete grievance timeline template step:", error);
      res.status(500).json({ message: "Failed to delete timeline step" });
    }
  });
}

/**
 * Confirms the status ids and step id referenced by a step body still exist.
 * Sends a 400 and returns the Response when something is missing; returns
 * undefined when everything resolves.
 */
async function validateStepReferences(
  data: z.infer<typeof stepBodySchema>,
  res: Response,
): Promise<Response | undefined> {
  const statusesOk = await storage.grievanceTimelineTemplates.statusesExist([
    ...data.fromStatuses,
    ...data.toStatuses,
  ]);
  if (!statusesOk) {
    return res.status(400).json({ message: "One or more selected statuses no longer exist" });
  }
  const stepOk = await storage.grievanceTimelineTemplates.stepExists(data.stepId);
  if (!stepOk) {
    return res.status(400).json({ message: "The selected step no longer exists" });
  }
  return undefined;
}
