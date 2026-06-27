import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (
  policy: any,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const createGrievanceSchema = z.object({
  complaint: z.string().trim().min(1, "Complaint is required").nullish(),
  remedy: z.string().trim().min(1).nullish(),
  statusId: z.string().uuid("A valid status is required"),
  categoryId: z.string().uuid("A valid category is required"),
  workerIds: z.array(z.string().uuid()).optional(),
  employerIds: z.array(z.string().uuid()).optional(),
});

const updateGrievanceSchema = z
  .object({
    complaint: z.string().trim().min(1).nullish(),
    remedy: z.string().trim().min(1).nullish(),
    statusId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const linkWorkerSchema = z.object({ workerId: z.string().uuid("A valid worker is required") });
const linkEmployerSchema = z.object({ employerId: z.string().uuid("A valid employer is required") });

export function registerGrievanceRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: PolicyMiddleware,
) {
  const gate = [requireAuth, requireComponent("grievance"), requireAccess("staff")] as const;

  app.get("/api/grievances", ...gate, async (_req, res) => {
    try {
      const records = await storage.grievances.list();
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch grievances:", error);
      res.status(500).json({ message: "Failed to fetch grievances" });
    }
  });

  app.post("/api/grievances", ...gate, async (req, res) => {
    try {
      const parsed = createGrievanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }

      const { workerIds, employerIds, complaint, remedy, statusId, categoryId } = parsed.data;

      const created = await storage.grievances.create({
        complaint: complaint ?? null,
        remedy: remedy ?? null,
        statusId,
        categoryId,
      });

      for (const workerId of workerIds ?? []) {
        await storage.grievances.addWorker(created.id, workerId);
      }
      for (const employerId of employerIds ?? []) {
        await storage.grievances.addEmployer(created.id, employerId);
      }

      const fresh = await storage.grievances.getWithDetails(created.id);
      res.status(201).json(fresh);
    } catch (error) {
      console.error("Failed to create grievance:", error);
      res.status(500).json({ message: "Failed to create grievance" });
    }
  });

  app.get("/api/grievances/:id", ...gate, async (req, res) => {
    try {
      const record = await storage.grievances.getWithDetails(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch grievance:", error);
      res.status(500).json({ message: "Failed to fetch grievance" });
    }
  });

  app.patch("/api/grievances/:id", ...gate, async (req, res) => {
    try {
      const parsed = updateGrievanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }

      const existing = await storage.grievances.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Grievance not found" });
      }

      const data: Record<string, unknown> = {};
      if (parsed.data.complaint !== undefined) data.complaint = parsed.data.complaint ?? null;
      if (parsed.data.remedy !== undefined) data.remedy = parsed.data.remedy ?? null;
      if (parsed.data.statusId !== undefined) data.statusId = parsed.data.statusId;
      if (parsed.data.categoryId !== undefined) data.categoryId = parsed.data.categoryId;

      await storage.grievances.update(req.params.id, data);
      const fresh = await storage.grievances.getWithDetails(req.params.id);
      res.json(fresh);
    } catch (error) {
      console.error("Failed to update grievance:", error);
      res.status(500).json({ message: "Failed to update grievance" });
    }
  });

  app.delete("/api/grievances/:id", ...gate, async (req, res) => {
    try {
      const existing = await storage.grievances.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const deleted = await storage.grievances.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Failed to delete grievance:", error);
      res.status(500).json({ message: "Failed to delete grievance" });
    }
  });

  app.post("/api/grievances/:id/workers", ...gate, async (req, res) => {
    try {
      const parsed = linkWorkerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      await storage.grievances.addWorker(req.params.id, parsed.data.workerId);
      const workers = await storage.grievances.listWorkers(req.params.id);
      res.status(201).json(workers);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Worker is already linked to this grievance" });
      }
      console.error("Failed to link worker to grievance:", error);
      res.status(500).json({ message: "Failed to link worker" });
    }
  });

  app.delete("/api/grievances/:id/workers/:workerId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeWorker(req.params.id, req.params.workerId);
      if (!removed) {
        return res.status(404).json({ message: "Worker link not found" });
      }
      const workers = await storage.grievances.listWorkers(req.params.id);
      res.json(workers);
    } catch (error) {
      console.error("Failed to unlink worker from grievance:", error);
      res.status(500).json({ message: "Failed to unlink worker" });
    }
  });

  app.post("/api/grievances/:id/employers", ...gate, async (req, res) => {
    try {
      const parsed = linkEmployerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      await storage.grievances.addEmployer(req.params.id, parsed.data.employerId);
      const employers = await storage.grievances.listEmployers(req.params.id);
      res.status(201).json(employers);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Employer is already linked to this grievance" });
      }
      console.error("Failed to link employer to grievance:", error);
      res.status(500).json({ message: "Failed to link employer" });
    }
  });

  app.delete("/api/grievances/:id/employers/:employerId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeEmployer(req.params.id, req.params.employerId);
      if (!removed) {
        return res.status(404).json({ message: "Employer link not found" });
      }
      const employers = await storage.grievances.listEmployers(req.params.id);
      res.json(employers);
    } catch (error) {
      console.error("Failed to unlink employer from grievance:", error);
      res.status(500).json({ message: "Failed to unlink employer" });
    }
  });
}
