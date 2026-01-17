import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { requireComponent } from "./components";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;
type RequirePermission = (permission: string) => (req: Request, res: Response, next: () => void) => void;

const createWorkerCertificationApiSchema = z.object({
  workerId: z.string(),
  certificationId: z.string(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  status: z.enum(["pending", "granted", "revoked", "expired"]).optional(),
  data: z.record(z.any()).optional().nullable(),
  message: z.string().optional(),
});

const updateWorkerCertificationApiSchema = z.object({
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  status: z.enum(["pending", "granted", "revoked", "expired"]).optional(),
  data: z.record(z.any()).optional().nullable(),
  message: z.string().optional(),
});

const deleteWorkerCertificationApiSchema = z.object({
  message: z.string().optional(),
});

export function registerWorkerCertificationsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  requirePermission: RequirePermission
) {
  const certificationsComponent = requireComponent("worker.certifications");

  app.get("/api/worker-certifications/worker/:workerId", requireAuth, certificationsComponent, requireAccess('worker.view', (req) => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const certifications = await storage.workerCertifications.getByWorker(req.params.workerId);
      res.json(certifications);
    } catch (error) {
      console.error("Error fetching worker certifications:", error);
      res.status(500).json({ error: "Failed to fetch worker certifications" });
    }
  });

  app.get("/api/worker-certifications/:id", requireAuth, certificationsComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const certification = await storage.workerCertifications.get(req.params.id);
      if (!certification) {
        return res.status(404).json({ error: "Worker certification not found" });
      }
      (req as any).certificationRecord = certification;
      return requireAccess('worker.view', () => certification.workerId)(req, res, next);
    } catch (error) {
      console.error("Error fetching worker certification:", error);
      res.status(500).json({ error: "Failed to fetch worker certification" });
    }
  }, async (req: Request, res: Response) => {
    try {
      const certification = (req as any).certificationRecord;
      res.json(certification);
    } catch (error) {
      console.error("Error in worker certification handler:", error);
      res.status(500).json({ error: "Failed to fetch worker certification" });
    }
  });

  app.post("/api/worker-certifications", requireAuth, certificationsComponent, requirePermission('staff'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = createWorkerCertificationApiSchema.parse(req.body);
      (req as any).validatedCertification = validated;
      return requireAccess('worker.view', () => validated.workerId)(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error validating worker certification:", error);
      res.status(500).json({ error: "Failed to validate worker certification" });
    }
  }, async (req: Request, res: Response) => {
    try {
      const validated = (req as any).validatedCertification;
      const certification = await storage.workerCertifications.create({
        workerId: validated.workerId,
        certificationId: validated.certificationId,
        startDate: validated.startDate || null,
        endDate: validated.endDate || null,
        status: validated.status || "pending",
        data: validated.data ?? null,
        message: validated.message,
      });
      res.status(201).json(certification);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
          return res.status(409).json({ error: "This certification is already assigned to this worker" });
        }
        console.error("Error creating worker certification:", error.message);
        return res.status(400).json({ error: error.message });
      }
      console.error("Error creating worker certification:", error);
      res.status(500).json({ error: "Failed to create worker certification" });
    }
  });

  app.patch("/api/worker-certifications/:id", requireAuth, certificationsComponent, requirePermission('staff'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await storage.workerCertifications.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Worker certification not found" });
      }
      (req as any).certificationRecord = existing;
      return requireAccess('worker.view', () => existing.workerId)(req, res, next);
    } catch (error) {
      console.error("Error fetching worker certification for update:", error);
      res.status(500).json({ error: "Failed to fetch worker certification" });
    }
  }, async (req: Request, res: Response) => {
    try {
      const validated = updateWorkerCertificationApiSchema.parse(req.body);
      const certification = await storage.workerCertifications.update(req.params.id, {
        startDate: validated.startDate,
        endDate: validated.endDate,
        status: validated.status,
        data: validated.data,
        message: validated.message,
      });
      if (!certification) {
        return res.status(404).json({ error: "Worker certification not found" });
      }
      res.json(certification);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error updating worker certification:", error);
      res.status(500).json({ error: "Failed to update worker certification" });
    }
  });

  app.delete("/api/worker-certifications/:id", requireAuth, certificationsComponent, requirePermission('staff'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await storage.workerCertifications.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Worker certification not found" });
      }
      (req as any).certificationRecord = existing;
      return requireAccess('worker.view', () => existing.workerId)(req, res, next);
    } catch (error) {
      console.error("Error fetching worker certification for delete:", error);
      res.status(500).json({ error: "Failed to fetch worker certification" });
    }
  }, async (req: Request, res: Response) => {
    try {
      const body = deleteWorkerCertificationApiSchema.parse(req.body || {});
      const deleted = await storage.workerCertifications.delete(req.params.id, body.message);
      if (!deleted) {
        return res.status(404).json({ error: "Worker certification not found" });
      }
      res.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error deleting worker certification:", error);
      res.status(500).json({ error: "Failed to delete worker certification" });
    }
  });

}
