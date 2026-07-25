import type { Express, Request, Response } from "express";
import { insertWorkerDispatchDepartmentSchema } from "@shared/schema";
import { WorkerDispatchDepartmentModeError } from "../../storage/dispatch/worker-departments";
import { storage } from "../../storage";
import { createUnifiedOptionsStorage } from "../../storage/unified-options";
import { z } from "zod";
import { requireComponent } from "../components";
import { requireAccess } from "../../services/access-policy-evaluator";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

export interface AvailableDepartment {
  id: string;
  name: string;
}

/**
 * Departments flagged "Available for dispatch?" (stored in the option's
 * `data` jsonb). Absence of the flag means NOT available.
 */
export async function getAvailableDispatchDepartments(): Promise<AvailableDepartment[]> {
  const departments = await unifiedOptionsStorage.list("department");
  return departments
    .filter((d: any) => d?.data?.availableForDispatch === true)
    .map((d: any) => ({ id: d.id, name: d.name }));
}

const setJobDepartmentSchema = z.object({
  departmentId: z.string().nullable(),
});

export function registerWorkerDispatchDepartmentRoutes(app: Express) {
  const departmentComponent = requireComponent("dispatch.department");

  // Departments selectable for dispatch (worker preferences + job forms).
  app.get("/api/dispatch-departments/available", departmentComponent, requireAccess('authenticated'), async (_req: Request, res: Response) => {
    try {
      res.json(await getAvailableDispatchDepartments());
    } catch (error) {
      console.error("Error fetching available dispatch departments:", error);
      res.status(500).json({ error: "Failed to fetch available departments" });
    }
  });

  // Worker department preferences
  app.get("/api/worker-dispatch-departments/worker/:workerId", departmentComponent, requireAccess('worker.view', (req: Request) => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const entries = await storage.workerDispatchDepartments.getByWorker(req.params.workerId);
      res.json(entries);
    } catch (error) {
      console.error("Error fetching worker department preferences:", error);
      res.status(500).json({ error: "Failed to fetch department preferences" });
    }
  });

  app.post("/api/worker-dispatch-departments", departmentComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = insertWorkerDispatchDepartmentSchema.parse(req.body);

      const available = await getAvailableDispatchDepartments();
      if (!available.some((d) => d.id === validated.departmentId)) {
        return res.status(400).json({ error: "This department is not available for dispatch" });
      }

      const entry = await storage.workerDispatchDepartments.create(validated);
      res.status(201).json(entry);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      if (error instanceof WorkerDispatchDepartmentModeError) {
        return res.status(409).json({ error: error.message });
      }
      if (error?.code === '23505') {
        return res.status(409).json({ error: "This department is already in the worker's preferences" });
      }
      console.error("Error creating worker department preference:", error);
      res.status(500).json({ error: "Failed to create department preference" });
    }
  });

  app.delete("/api/worker-dispatch-departments/:id", departmentComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const deleted = await storage.workerDispatchDepartments.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Department preference not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting worker department preference:", error);
      res.status(500).json({ error: "Failed to delete department preference" });
    }
  });

  // Batch lookup for job lists: ?jobIds=a,b,c -> { [jobId]: { departmentId, departmentName } }
  // Read-only lookups are open to any authenticated user: workers see their
  // accepted jobs' departments on the dispatch-status page, and the data
  // (job -> department name) is not sensitive. Writes below stay staff-only.
  app.get("/api/dispatch-job-departments", departmentComponent, requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      const jobIds = String(req.query.jobIds || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (jobIds.length === 0) return res.json({});
      if (jobIds.length > 200) {
        return res.status(400).json({ error: "Too many jobIds (max 200)" });
      }

      const entries = await storage.dispatchJobDepartments.getByJobIds(jobIds);
      const result: Record<string, { departmentId: string; departmentName: string | null }> = {};
      entries.forEach((entry, jobId) => {
        result[jobId] = {
          departmentId: entry.departmentId,
          departmentName: entry.department?.name ?? null,
        };
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching job departments:", error);
      res.status(500).json({ error: "Failed to fetch job departments" });
    }
  });

  // Job department (at most one per job)
  app.get("/api/dispatch-job-departments/job/:jobId", departmentComponent, requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      const entry = await storage.dispatchJobDepartments.getByJob(req.params.jobId);
      res.json(entry ?? null);
    } catch (error) {
      console.error("Error fetching job department:", error);
      res.status(500).json({ error: "Failed to fetch job department" });
    }
  });

  app.put("/api/dispatch-job-departments/job/:jobId", departmentComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const { departmentId } = setJobDepartmentSchema.parse(req.body);

      const job = await storage.dispatchJobs.get(req.params.jobId);
      if (!job) {
        return res.status(404).json({ error: "Dispatch job not found" });
      }

      if (departmentId === null) {
        await storage.dispatchJobDepartments.clearForJob(req.params.jobId);
        return res.json(null);
      }

      const available = await getAvailableDispatchDepartments();
      if (!available.some((d) => d.id === departmentId)) {
        return res.status(400).json({ error: "This department is not available for dispatch" });
      }

      await storage.dispatchJobDepartments.setForJob(req.params.jobId, departmentId);
      res.json(await storage.dispatchJobDepartments.getByJob(req.params.jobId));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error setting job department:", error);
      res.status(500).json({ error: "Failed to set job department" });
    }
  });
}
