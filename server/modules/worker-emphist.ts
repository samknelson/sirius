import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertWorkerEmphistSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerWorkerEmphistRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  
  // GET /api/workers/:workerId/emphist - Get all employment history for a worker (requires worker policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/emphist", requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      const emphist = await storage.workerEmphist.getWorkerEmphistByWorkerId(workerId);
      res.json(emphist);
    } catch (error) {
      console.error("Error fetching worker employment history:", error);
      res.status(500).json({ message: "Failed to fetch employment history" });
    }
  });

  // GET /api/worker-emphist/:id - Get a specific employment history record (requires workers.view permission)
  app.get("/api/worker-emphist/:id", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const { id } = req.params;
      const emphist = await storage.workerEmphist.getWorkerEmphist(id);
      
      if (!emphist) {
        res.status(404).json({ message: "Employment history record not found" });
        return;
      }
      
      res.json(emphist);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employment history record" });
    }
  });

  // POST /api/workers/:workerId/emphist - Create a new employment history record (requires worker policy: staff or worker with matching email)
  app.post("/api/workers/:workerId/emphist", requireAccess(policies.worker), async (req, res) => {
    try {
      const { workerId } = req.params;
      
      // Verify the worker exists
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Merge workerId from params into request body before validation
      const dataWithWorkerId = {
        ...req.body,
        workerId
      };
      
      // Validate request body
      const result = insertWorkerEmphistSchema.safeParse(dataWithWorkerId);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid employment history data",
          errors: result.error.errors 
        });
      }
      
      // If employerId is provided, verify it exists
      if (result.data.employerId) {
        const employer = await storage.employers.getEmployer(result.data.employerId);
        if (!employer) {
          return res.status(404).json({ message: "Employer not found" });
        }
      }
      
      // If employmentStatus is provided, verify it exists
      if (result.data.employmentStatus) {
        const status = await storage.options.employmentStatus.get(result.data.employmentStatus);
        if (!status) {
          return res.status(404).json({ message: "Employment status not found" });
        }
      }
      
      const emphist = await storage.workerEmphist.createWorkerEmphist(result.data);
      res.status(201).json(emphist);
    } catch (error: any) {
      console.error("Error creating employment history:", error);
      res.status(500).json({ message: "Failed to create employment history" });
    }
  });

  // PUT /api/worker-emphist/:id - Update an employment history record (requires worker policy: staff or worker with matching email)
  // Middleware 1: Fetch record and set workerId for policy validation
  const prepareWorkerEmphistUpdate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const existing = await storage.workerEmphist.getWorkerEmphist(id);
      if (!existing) {
        return res.status(404).json({ message: "Employment history record not found" });
      }
      req.params.workerId = existing.workerId;
      next();
    } catch (error) {
      console.error("Error preparing employment history update:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };
  
  app.put("/api/worker-emphist/:id", requireAuth, prepareWorkerEmphistUpdate, requireAccess(policies.worker), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Fetch the record again for the update operation
      const existing = await storage.workerEmphist.getWorkerEmphist(id);
      if (!existing) {
        return res.status(404).json({ message: "Employment history record not found" });
      }
      
      // Validate partial update, but exclude workerId from updates (prevent reassignment)
      const result = insertWorkerEmphistSchema.partial().omit({ workerId: true }).safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid employment history data",
          errors: result.error.errors 
        });
      }
      
      // Ensure workerId cannot be changed (security: prevent record reassignment)
      if (req.body.workerId && req.body.workerId !== existing.workerId) {
        return res.status(400).json({ 
          message: "Cannot change worker ID for employment history record" 
        });
      }
      
      // If employerId is being updated, verify it exists
      if (result.data.employerId !== undefined && result.data.employerId !== null) {
        const employer = await storage.employers.getEmployer(result.data.employerId);
        if (!employer) {
          return res.status(404).json({ message: "Employer not found" });
        }
      }
      
      // If employmentStatus is being updated, verify it exists
      if (result.data.employmentStatus !== undefined && result.data.employmentStatus !== null) {
        const status = await storage.options.employmentStatus.get(result.data.employmentStatus);
        if (!status) {
          return res.status(404).json({ message: "Employment status not found" });
        }
      }
      
      const emphist = await storage.workerEmphist.updateWorkerEmphist(id, result.data);
      
      if (!emphist) {
        res.status(404).json({ message: "Employment history record not found" });
        return;
      }
      
      res.json(emphist);
    } catch (error: any) {
      console.error("Error updating employment history:", error);
      res.status(500).json({ message: "Failed to update employment history" });
    }
  });

  // DELETE /api/worker-emphist/:id - Delete an employment history record (requires worker policy: staff or worker with matching email)
  // Middleware: Fetch record and set workerId for policy validation
  const prepareWorkerEmphistDelete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const existing = await storage.workerEmphist.getWorkerEmphist(id);
      if (!existing) {
        return res.status(404).json({ message: "Employment history record not found" });
      }
      req.params.workerId = existing.workerId;
      next();
    } catch (error) {
      console.error("Error preparing employment history delete:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  };
  
  app.delete("/api/worker-emphist/:id", requireAuth, prepareWorkerEmphistDelete, requireAccess(policies.worker), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.workerEmphist.deleteWorkerEmphist(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Employment history record not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete employment history" });
    }
  });
}
