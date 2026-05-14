import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { insertWorkerRelationSchema } from "@shared/schema";
import { z } from "zod";
import { requireComponent } from "../components";
import { WorkerRelationValidationError } from "../../storage/workers/relations";

type RequireAccess = (
  policy: string,
  getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined,
) => (req: Request, res: Response, next: NextFunction) => void;
type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;

const createApiSchema = insertWorkerRelationSchema.extend({
  worker1: z.string().min(1),
  worker2: z.string().min(1),
  relationType: z.string().min(1),
  startYmd: z.union([z.string(), z.coerce.date()]),
  endYmd: z.union([z.string(), z.coerce.date()]).nullable().optional(),
});

const updateApiSchema = z.object({
  relationType: z.string().min(1).optional(),
  startYmd: z.union([z.string(), z.coerce.date()]).optional(),
  endYmd: z.union([z.string(), z.coerce.date()]).nullable().optional(),
  data: z.any().optional(),
});

function handleError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid data", details: error.errors });
  }
  if (error instanceof WorkerRelationValidationError) {
    return res.status(400).json({ error: error.message, field: error.field });
  }
  console.error(fallback, error);
  if (error instanceof Error) {
    return res.status(500).json({ error: fallback, details: error.message });
  }
  return res.status(500).json({ error: fallback });
}

export function registerWorkerRelationsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
) {
  const relationsComponent = requireComponent("worker.relations");

  // List relations for a worker (both directions)
  app.get(
    "/api/workers/:id/relations",
    requireAuth,
    relationsComponent,
    requireAccess('worker.view', (req) => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const role = (req.query.role as string | undefined) ?? 'either';
        if (role !== 'worker_1' && role !== 'worker_2' && role !== 'either') {
          return res.status(400).json({ error: "Invalid role; must be worker_1, worker_2, or either" });
        }
        let activeAt: Date | null | undefined;
        if (req.query.activeAt !== undefined) {
          if (req.query.activeAt === '' || req.query.activeAt === 'null') {
            activeAt = undefined;
          } else {
            const parsed = new Date(String(req.query.activeAt));
            if (isNaN(parsed.getTime())) {
              return res.status(400).json({ error: "Invalid activeAt date" });
            }
            activeAt = parsed;
          }
        }
        const relationTypeId = (req.query.relationTypeId as string | undefined) || undefined;
        const rows = await storage.workerRelations.searchWorkerRelations({
          workerId: req.params.id,
          role,
          activeAt,
          relationTypeId,
        });
        res.json(rows);
      } catch (error) {
        handleError(res, error, "Failed to fetch worker relations");
      }
    },
  );

  // Get a specific relation by id
  app.get(
    "/api/worker-relations/:id",
    requireAuth,
    relationsComponent,
    async (req: Request, res: Response, next: NextFunction) => {
      const relation = await storage.workerRelations.get(req.params.id);
      if (!relation) {
        return res.status(404).json({ error: "Worker relation not found" });
      }
      (req as any).relationEntry = Object.freeze({ ...relation });
      next();
    },
    requireAccess('worker.view', (req) => (req as any).relationEntry?.worker1),
    async (req: Request, res: Response) => {
      res.json((req as any).relationEntry);
    },
  );

  // Create
  app.post(
    "/api/workers/:id/relations",
    requireAuth,
    relationsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const body = { ...req.body, worker1: req.body.worker1 ?? req.params.id };
        const validated = createApiSchema.parse(body);
        const created = await storage.workerRelations.create(validated as any);
        res.status(201).json(created);
      } catch (error) {
        handleError(res, error, "Failed to create worker relation");
      }
    },
  );

  // Update
  app.patch(
    "/api/worker-relations/:id",
    requireAuth,
    relationsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const validated = updateApiSchema.parse(req.body);
        const updated = await storage.workerRelations.update(req.params.id, validated as any);
        if (!updated) {
          return res.status(404).json({ error: "Worker relation not found" });
        }
        res.json(updated);
      } catch (error) {
        handleError(res, error, "Failed to update worker relation");
      }
    },
  );

  // Delete
  app.delete(
    "/api/worker-relations/:id",
    requireAuth,
    relationsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const deleted = await storage.workerRelations.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ error: "Worker relation not found" });
        }
        res.status(204).send();
      } catch (error) {
        handleError(res, error, "Failed to delete worker relation");
      }
    },
  );
}
