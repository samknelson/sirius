import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { createUnifiedOptionsStorage } from "../storage/unified-options";
import { z } from "zod";
import { requireComponent } from "./components";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const createWorkerSkillApiSchema = z.object({
  workerId: z.string(),
  skillId: z.string(),
  message: z.string().optional(),
  data: z.record(z.any()).optional().nullable(),
});

const deleteWorkerSkillApiSchema = z.object({
  message: z.string().optional(),
});

export function registerWorkerSkillsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const skillsComponent = requireComponent("worker.skills");

  app.get("/api/worker-skills/worker/:workerId", requireAuth, skillsComponent, requireAccess('worker.view'), async (req: Request, res: Response) => {
    try {
      const skills = await storage.workerSkills.getByWorker(req.params.workerId);
      res.json(skills);
    } catch (error) {
      console.error("Error fetching worker skills:", error);
      res.status(500).json({ error: "Failed to fetch worker skills" });
    }
  });

  app.get("/api/worker-skills/:id", requireAuth, skillsComponent, requireAccess('worker.view'), async (req: Request, res: Response) => {
    try {
      const skill = await storage.workerSkills.get(req.params.id);
      if (!skill) {
        return res.status(404).json({ error: "Worker skill not found" });
      }
      res.json(skill);
    } catch (error) {
      console.error("Error fetching worker skill:", error);
      res.status(500).json({ error: "Failed to fetch worker skill" });
    }
  });

  app.post("/api/worker-skills", requireAuth, skillsComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = createWorkerSkillApiSchema.parse(req.body);
      const skill = await storage.workerSkills.create({
        workerId: validated.workerId,
        skillId: validated.skillId,
        message: validated.message,
        data: validated.data ?? null,
      });
      res.status(201).json(skill);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      if (error instanceof Error) {
        if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
          return res.status(409).json({ error: "This skill is already assigned to this worker" });
        }
        console.error("Error creating worker skill:", error.message);
        return res.status(400).json({ error: error.message });
      }
      console.error("Error creating worker skill:", error);
      res.status(500).json({ error: "Failed to create worker skill" });
    }
  });

  app.delete("/api/worker-skills/:id", requireAuth, skillsComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const body = deleteWorkerSkillApiSchema.parse(req.body || {});
      const deleted = await storage.workerSkills.delete(req.params.id, body.message);
      if (!deleted) {
        return res.status(404).json({ error: "Worker skill not found" });
      }
      res.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error deleting worker skill:", error);
      res.status(500).json({ error: "Failed to delete worker skill" });
    }
  });

  app.get("/api/options/skills", requireAuth, skillsComponent, async (req: Request, res: Response) => {
    try {
      const skills = await unifiedOptionsStorage.list("skill");
      res.json(skills);
    } catch (error) {
      console.error("Error fetching skill options:", error);
      res.status(500).json({ error: "Failed to fetch skill options" });
    }
  });
}
