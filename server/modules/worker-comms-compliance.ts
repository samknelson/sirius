import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAccess, checkAccess } from "../services/access-policy-evaluator";
import { requireComponent, isComponentEnabled } from "./components";
import { getEffectiveUser } from "./masquerade";
import { logger } from "../logger";
import { complianceViewSchema, WORKER_COMMS_COMPONENT } from "@shared/worker-comms-compliance";
import { listWorkerCommsDefinitions, getWorkerCommsDefinition, saveWorkerCommsDefinition,
  deleteWorkerCommsDefinition, validateWorkerCommsReferences, WorkerCommsError } from "../services/worker-comms-compliance";

const reportQuerySchema = z.object({
  view: complianceViewSchema.default("all"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function registerWorkerCommsComplianceRoutes(
  app: Express, requireAuth: (req: Request, res: Response, next: NextFunction) => void,
) {
  const prefix = "/api/worker-comms-compliance";
  const gate = [requireAuth, requireComponent(WORKER_COMMS_COMPONENT), requireAccess("staff")];
  const handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "private, no-store");
      try { await fn(req, res); } catch (error) {
        if (error instanceof WorkerCommsError) return res.status(error.status).json({ message: error.message });
        if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid compliance request", errors: error.issues });
        logger.error("Worker comms compliance request failed", { service: "worker-comms-compliance", error });
        res.status(500).json({ message: "Unable to load or save worker communications compliance. Please try again." });
      }
    };
  app.get(`${prefix}/options`, ...gate, handle(async (req, res) => {
    const { dbUser } = await getEffectiveUser(req.session ?? {}, req.user);
    if (!dbUser) return res.status(401).json({ message: "Not authenticated" });
    const [options, manage, bulk] = await Promise.all([
      storage.workerCommsCompliance.options(), checkAccess("admin", dbUser), checkAccess("bulk.edit", dbUser),
    ]);
    res.json({ ...options, canManage: manage.granted, canBulk: bulk.granted && await isComponentEnabled("bulk") });
  }));
  app.get(`${prefix}/definitions`, ...gate, handle(async (_req, res) => {
    res.json(await listWorkerCommsDefinitions(storage));
  }));
  app.post(`${prefix}/definitions`, ...gate, requireAccess("admin"), handle(async (req, res) => {
    res.status(201).json(await saveWorkerCommsDefinition(storage, req.body));
  }));
  app.put(`${prefix}/definitions/:id`, ...gate, requireAccess("admin"), handle(async (req, res) => {
    res.json(await saveWorkerCommsDefinition(storage, req.body, req.params.id));
  }));
  app.delete(`${prefix}/definitions/:id`, ...gate, requireAccess("admin"), handle(async (req, res) => {
    await deleteWorkerCommsDefinition(storage, req.params.id);
    res.json({ success: true });
  }));
  app.get(`${prefix}/definitions/:id/report`, ...gate, handle(async (req, res) => {
    const query = reportQuerySchema.parse(req.query);
    const definition = await getWorkerCommsDefinition(storage, req.params.id);
    await validateWorkerCommsReferences(storage, definition);
    res.json(await storage.workerCommsCompliance.report(definition, query.view, query.page, query.pageSize));
  }));
  app.get(`${prefix}/definitions/:id/contacts`, ...gate, requireAccess("bulk.edit"), requireComponent("bulk"), handle(async (req, res) => {
    const { view } = reportQuerySchema.parse(req.query);
    const definition = await getWorkerCommsDefinition(storage, req.params.id);
    await validateWorkerCommsReferences(storage, definition);
    const contactIds = await storage.workerCommsCompliance.contacts(definition, view);
    res.json({ contactIds, total: contactIds.length });
  }));
}
