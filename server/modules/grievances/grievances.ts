import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { GRIEVANCE_CARDINALITIES } from "@shared/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (
  policy: any,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const createGrievanceSchema = z
  .object({
    complaint: z.string().trim().min(1, "Complaint is required").nullish(),
    remedy: z.string().trim().min(1).nullish(),
    classDescription: z.string().trim().min(1).nullish(),
    statusId: z.string().uuid("A valid status is required"),
    categoryId: z.string().uuid("A valid category is required"),
    cardinality: z.enum(GRIEVANCE_CARDINALITIES).default("individual"),
  })
  .refine((v) => v.cardinality === "class" || v.classDescription == null, {
    message: "A class description is only allowed for class grievances",
    path: ["classDescription"],
  });

const editWorkerSchema = z
  .object({
    primary: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const updateGrievanceSchema = z
  .object({
    complaint: z.string().trim().min(1).nullish(),
    remedy: z.string().trim().min(1).nullish(),
    classDescription: z.string().trim().min(1).nullish(),
    statusId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    cardinality: z.enum(GRIEVANCE_CARDINALITIES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const searchGrievancesSchema = z.object({
  workerId: z.string().uuid().optional(),
  employerId: z.string().uuid().optional(),
});

const linkWorkerSchema = z.object({ workerId: z.string().uuid("A valid worker is required") });
const linkEmployerSchema = z.object({ employerId: z.string().uuid("A valid employer is required") });

export function registerGrievanceRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: PolicyMiddleware,
) {
  const gate = [requireAuth, requireComponent("grievance"), requireAccess("staff")] as const;

  app.get("/api/grievances", ...gate, async (req, res) => {
    try {
      const parsed = searchGrievancesSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query parameters", errors: parsed.error.flatten() });
      }
      const records = await storage.grievances.search(parsed.data);
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

      const {
        complaint,
        remedy,
        classDescription,
        statusId,
        categoryId,
        cardinality,
      } = parsed.data;

      const created = await storage.grievances.create({
        complaint: complaint ?? null,
        remedy: remedy ?? null,
        classDescription: cardinality === "class" ? (classDescription ?? null) : null,
        statusId,
        categoryId,
        cardinality,
      });

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

      const newCardinality = parsed.data.cardinality ?? existing.cardinality;
      const newClassDescription =
        parsed.data.classDescription !== undefined
          ? (parsed.data.classDescription ?? null)
          : existing.classDescription;

      // A class description may only exist on a class grievance. Switching away
      // from class requires clearing it in the same request.
      if (newCardinality !== "class" && newClassDescription != null) {
        return res.status(400).json({
          message:
            "A class description is only allowed for class grievances. Clear it before changing the cardinality.",
        });
      }

      // Reject cardinality transitions that the currently-linked workers violate.
      if (
        parsed.data.cardinality !== undefined &&
        parsed.data.cardinality !== existing.cardinality
      ) {
        const stats = await storage.grievances.getWorkerStats(req.params.id);
        if (newCardinality === "class" && stats.count > 0) {
          return res.status(400).json({
            message: "Remove all workers before changing this grievance to a class grievance.",
          });
        }
        if (newCardinality === "individual" && stats.count > 1) {
          return res.status(400).json({
            message:
              "An individual grievance can have at most one worker. Remove the extra workers first.",
          });
        }
        if (newCardinality === "multiple" && stats.primaryCount > 0) {
          return res.status(400).json({
            message: "A multiple grievance cannot have a lead worker. Clear the lead first.",
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (parsed.data.complaint !== undefined) data.complaint = parsed.data.complaint ?? null;
      if (parsed.data.remedy !== undefined) data.remedy = parsed.data.remedy ?? null;
      if (parsed.data.classDescription !== undefined)
        data.classDescription = parsed.data.classDescription ?? null;
      if (parsed.data.statusId !== undefined) data.statusId = parsed.data.statusId;
      if (parsed.data.categoryId !== undefined) data.categoryId = parsed.data.categoryId;
      if (parsed.data.cardinality !== undefined) data.cardinality = parsed.data.cardinality;

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
      // Cardinality enforcement (class rejection, individual single-worker
      // limit, and implicit-lead assignment) happens atomically inside the
      // storage method under a grievance row lock, so concurrent adds cannot
      // exceed the individual limit.
      const result = await storage.grievances.addWorkerForGrievance(
        req.params.id,
        parsed.data.workerId,
      );
      if ("error" in result) {
        if (result.error === "not-found") {
          return res.status(404).json({ message: "Grievance not found" });
        }
        if (result.error === "class") {
          return res.status(400).json({ message: "Class grievances cannot have workers." });
        }
        return res
          .status(400)
          .json({ message: "An individual grievance can have only one worker." });
      }
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

  app.patch("/api/grievances/:id/workers/:workerId", ...gate, async (req, res) => {
    try {
      const parsed = editWorkerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }

      if (parsed.data.primary === true) {
        if (grievance.cardinality === "class") {
          return res.status(400).json({ message: "Class grievances cannot have workers." });
        }
        if (grievance.cardinality === "multiple") {
          return res
            .status(400)
            .json({ message: "A multiple grievance cannot have a lead worker." });
        }
      }

      // An individual grievance's only worker is always its lead; it cannot be
      // demoted to a non-lead state.
      if (parsed.data.primary === false && grievance.cardinality === "individual") {
        return res
          .status(400)
          .json({ message: "The worker on an individual grievance is always the lead." });
      }

      const updated = await storage.grievances.updateWorker(
        req.params.id,
        req.params.workerId,
        { primary: parsed.data.primary },
      );
      if (!updated) {
        return res.status(404).json({ message: "Worker link not found" });
      }
      const workers = await storage.grievances.listWorkers(req.params.id);
      res.json(workers);
    } catch (error) {
      console.error("Failed to update grievance worker:", error);
      res.status(500).json({ message: "Failed to update worker" });
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
