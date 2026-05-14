import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import {
  insertWorkerTrustElectionSchema,
  type WorkerTrustElection,
  type InsertWorkerTrustElection,
} from "@shared/schema";
import { z } from "zod";
import { requireComponent } from "../components";
import { WorkerTrustElectionValidationError } from "../../storage/trust/elections";

type RequireAccess = (
  policy: string,
  getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined,
) => (req: Request, res: Response, next: NextFunction) => void;
type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;

declare module "express-serve-static-core" {
  interface Request {
    workerTrustElectionEntry?: Readonly<WorkerTrustElection>;
  }
}

const ymdOrDate = z.union([z.string(), z.coerce.date()]);

const createBodySchema = insertWorkerTrustElectionSchema
  .omit({ workerId: true })
  .extend({
    policyId: z.string().min(1),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate.nullable().optional(),
    benefitIds: z.array(z.string()).nullable().optional(),
    relationshipIds: z.array(z.string()).nullable().optional(),
    data: z.unknown().optional(),
  });

const updateBodySchema = z.object({
  policyId: z.string().min(1).optional(),
  startYmd: ymdOrDate.optional(),
  endYmd: ymdOrDate.nullable().optional(),
  benefitIds: z.array(z.string()).nullable().optional(),
  relationshipIds: z.array(z.string()).nullable().optional(),
  data: z.unknown().optional(),
});

function handleError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid data", details: error.errors });
  }
  if (error instanceof WorkerTrustElectionValidationError) {
    return res.status(400).json({ error: error.message, field: error.field });
  }
  console.error(fallback, error);
  if (error instanceof Error) {
    return res.status(500).json({ error: fallback, details: error.message });
  }
  return res.status(500).json({ error: fallback });
}

export function registerWorkerTrustElectionsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
) {
  const electionsComponent = requireComponent("trust.elections");

  // List elections for a worker
  app.get(
    "/api/workers/:id/trust-elections",
    requireAuth,
    electionsComponent,
    requireAccess('worker.view', (req) => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
        const policyId = (req.query.policyId as string | undefined) || undefined;
        const sortRaw = (req.query.sort as string | undefined) || 'startDesc';
        const sort = sortRaw === 'startAsc' ? 'startAsc' : 'startDesc';
        const rows = await storage.workerTrustElections.search({
          workerId: req.params.id,
          activeOnly,
          policyId,
          sort,
        });
        res.json(rows);
      } catch (error) {
        handleError(res, error, "Failed to fetch trust elections");
      }
    },
  );

  // Get current (active) election for a worker
  app.get(
    "/api/workers/:id/trust-elections/current",
    requireAuth,
    electionsComponent,
    requireAccess('worker.view', (req) => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const row = await storage.workerTrustElections.getActiveByWorker(req.params.id);
        res.json(row ?? null);
      } catch (error) {
        handleError(res, error, "Failed to fetch current trust election");
      }
    },
  );

  // Get one election (fetch then policy on workerId)
  app.get(
    "/api/trust-elections/:id",
    requireAuth,
    electionsComponent,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const row = await storage.workerTrustElections.getById(req.params.id);
        if (!row) return res.status(404).json({ error: "Trust election not found" });
        req.workerTrustElectionEntry = Object.freeze({ ...row });
        next();
      } catch (error) {
        handleError(res, error, "Failed to fetch trust election");
      }
    },
    requireAccess('worker.view', (req) => req.workerTrustElectionEntry?.workerId),
    async (req: Request, res: Response) => {
      res.json(req.workerTrustElectionEntry);
    },
  );

  // Create
  app.post(
    "/api/workers/:id/trust-elections",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const parsed = createBodySchema.parse(req.body);
        const insert: InsertWorkerTrustElection = {
          workerId: req.params.id,
          policyId: parsed.policyId,
          startYmd: parsed.startYmd as InsertWorkerTrustElection["startYmd"],
          endYmd: (parsed.endYmd ?? null) as InsertWorkerTrustElection["endYmd"],
          benefitIds: parsed.benefitIds ?? null,
          relationshipIds: parsed.relationshipIds ?? null,
          data: parsed.data as InsertWorkerTrustElection["data"],
        };
        const created = await storage.workerTrustElections.create(insert);
        res.status(201).json(created);
      } catch (error) {
        handleError(res, error, "Failed to create trust election");
      }
    },
  );

  // Update (workerId immutable)
  app.patch(
    "/api/trust-elections/:id",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const parsed = updateBodySchema.parse(req.body);
        const patch: Partial<Omit<InsertWorkerTrustElection, 'workerId'>> = {};
        if (parsed.policyId !== undefined) patch.policyId = parsed.policyId;
        if (parsed.startYmd !== undefined) patch.startYmd = parsed.startYmd as InsertWorkerTrustElection["startYmd"];
        if (parsed.endYmd !== undefined) patch.endYmd = parsed.endYmd as InsertWorkerTrustElection["endYmd"];
        if (parsed.benefitIds !== undefined) patch.benefitIds = parsed.benefitIds;
        if (parsed.relationshipIds !== undefined) patch.relationshipIds = parsed.relationshipIds;
        if (parsed.data !== undefined) patch.data = parsed.data as InsertWorkerTrustElection["data"];
        const updated = await storage.workerTrustElections.update(req.params.id, patch);
        if (!updated) return res.status(404).json({ error: "Trust election not found" });
        res.json(updated);
      } catch (error) {
        handleError(res, error, "Failed to update trust election");
      }
    },
  );

  // Delete
  app.delete(
    "/api/trust-elections/:id",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const deleted = await storage.workerTrustElections.delete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Trust election not found" });
        res.status(204).send();
      } catch (error) {
        handleError(res, error, "Failed to delete trust election");
      }
    },
  );
}
