import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { WorkerTosValidationError, WorkerTosConflictError } from "../../storage/workers/tos";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const isoDateString = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: "Invalid date",
});

const startBodySchema = z.object({
  startDate: isoDateString.optional(),
  description: z.string().optional().nullable(),
  siriusId: z.string().optional().nullable(),
}).optional();

const stopBodySchema = z.object({
  endDate: isoDateString.optional(),
}).optional();

const patchBodySchema = z.object({
  startDate: isoDateString.optional(),
  endDate: isoDateString.nullable().optional(),
  description: z.string().nullable().optional(),
  siriusId: z.string().nullable().optional(),
});

function handleError(res: Response, err: unknown, fallbackMessage: string) {
  if (err instanceof WorkerTosConflictError) {
    return res.status(409).json({ error: err.message });
  }
  if (err instanceof WorkerTosValidationError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid data", details: err.errors });
  }
  console.error(fallbackMessage, err);
  return res.status(500).json({ error: fallbackMessage });
}

export function registerWorkerTosRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const tosComponent = requireComponent("worker.tos");

  app.get(
    "/api/workers/:workerId/tos",
    requireAuth,
    tosComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const records = await storage.workerTos.getByWorker(req.params.workerId);
        res.json(records);
      } catch (err) {
        handleError(res, err, "Failed to fetch worker TOS records");
      }
    }
  );

  app.post(
    "/api/workers/:workerId/tos/start",
    requireAuth,
    tosComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const body = startBodySchema.parse(req.body || {});
        const startDate = body?.startDate ? new Date(body.startDate) : new Date();
        const created = await storage.workerTos.create({
          workerId: req.params.workerId,
          startDate,
          endDate: null,
          description: body?.description ?? null,
          siriusId: body?.siriusId ?? null,
          data: null,
        });
        res.status(201).json(created);
      } catch (err) {
        handleError(res, err, "Failed to start absence");
      }
    }
  );

  app.post(
    "/api/workers/:workerId/tos/stop",
    requireAuth,
    tosComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const body = stopBodySchema.parse(req.body || {});
        const active = await storage.workerTos.getActiveForWorker(req.params.workerId);
        if (!active) {
          return res.status(409).json({ error: "This worker has no active absence to stop" });
        }
        const endDate = body?.endDate ? new Date(body.endDate) : new Date();
        const updated = await storage.workerTos.update(active.id, { endDate });
        res.json(updated);
      } catch (err) {
        handleError(res, err, "Failed to stop absence");
      }
    }
  );

  app.patch(
    "/api/worker-tos/:id",
    requireAuth,
    tosComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const body = patchBodySchema.parse(req.body || {});
        const patch: Parameters<typeof storage.workerTos.update>[1] = {};
        if (body.startDate !== undefined) patch.startDate = new Date(body.startDate);
        if (body.endDate !== undefined) patch.endDate = body.endDate === null ? null : new Date(body.endDate);
        if (body.description !== undefined) patch.description = body.description;
        if (body.siriusId !== undefined) patch.siriusId = body.siriusId;

        const updated = await storage.workerTos.update(req.params.id, patch);
        if (!updated) {
          return res.status(404).json({ error: "Absence record not found" });
        }
        res.json(updated);
      } catch (err) {
        handleError(res, err, "Failed to update absence");
      }
    }
  );

  app.delete(
    "/api/worker-tos/:id",
    requireAuth,
    tosComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const message = typeof req.body?.message === 'string' ? req.body.message : undefined;
        const deleted = await storage.workerTos.delete(req.params.id, message);
        if (!deleted) {
          return res.status(404).json({ error: "Absence record not found" });
        }
        res.status(204).send();
      } catch (err) {
        handleError(res, err, "Failed to delete absence");
      }
    }
  );
}
