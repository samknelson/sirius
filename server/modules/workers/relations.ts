import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import {
  insertWorkerRelationSchema,
  type WorkerRelation,
  type InsertWorkerRelation,
} from "@shared/schema";
import { z } from "zod";
import { requireComponent } from "../components";
import { WorkerRelationValidationError } from "../../storage/workers/relations";

type RequireAccess = (
  policy: string,
  getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined,
) => (req: Request, res: Response, next: NextFunction) => void;
type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;

declare module "express-serve-static-core" {
  interface Request {
    workerRelationEntry?: Readonly<WorkerRelation>;
  }
}

const ymdOrDate = z.union([z.string(), z.coerce.date()]);

const updateApiSchema = z.object({
  relationType: z.string().min(1).optional(),
  startYmd: ymdOrDate.optional(),
  endYmd: ymdOrDate.nullable().optional(),
  data: z.unknown().optional(),
});

const createBodySchema = insertWorkerRelationSchema
  .omit({ worker1: true })
  .extend({
    worker1: z.string().min(1).optional(),
    worker2: z.string().min(1),
    relationType: z.string().min(1),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate.nullable().optional(),
    data: z.unknown().optional(),
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

  // Get a specific relation by id (fetch-then-policy on worker_1)
  app.get(
    "/api/worker-relations/:id",
    requireAuth,
    relationsComponent,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const relation = await storage.workerRelations.get(req.params.id);
        if (!relation) {
          return res.status(404).json({ error: "Worker relation not found" });
        }
        req.workerRelationEntry = Object.freeze({ ...relation });
        next();
      } catch (error) {
        handleError(res, error, "Failed to fetch worker relation");
      }
    },
    requireAccess('worker.view', (req) => req.workerRelationEntry?.worker1),
    async (req: Request, res: Response) => {
      res.json(req.workerRelationEntry);
    },
  );

  // Create — worker1 is always the URL-scoped worker
  app.post(
    "/api/workers/:id/relations",
    requireAuth,
    relationsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const parsed = createBodySchema.parse(req.body);
        if (parsed.worker1 !== undefined && parsed.worker1 !== req.params.id) {
          return res.status(400).json({
            error: "worker1 in body must match the URL worker id",
            field: "worker1",
          });
        }
        const insert: InsertWorkerRelation = {
          worker1: req.params.id,
          worker2: parsed.worker2,
          relationType: parsed.relationType,
          startYmd: parsed.startYmd as InsertWorkerRelation["startYmd"],
          endYmd: parsed.endYmd as InsertWorkerRelation["endYmd"],
          data: parsed.data as InsertWorkerRelation["data"],
        };
        const created = await storage.workerRelations.create(insert);
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
        const parsed = updateApiSchema.parse(req.body);
        const patch: Partial<InsertWorkerRelation> = {};
        if (parsed.relationType !== undefined) patch.relationType = parsed.relationType;
        if (parsed.startYmd !== undefined) {
          patch.startYmd = parsed.startYmd as InsertWorkerRelation["startYmd"];
        }
        if (parsed.endYmd !== undefined) {
          patch.endYmd = parsed.endYmd as InsertWorkerRelation["endYmd"];
        }
        if (parsed.data !== undefined) {
          patch.data = parsed.data as InsertWorkerRelation["data"];
        }
        const updated = await storage.workerRelations.update(req.params.id, patch);
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
