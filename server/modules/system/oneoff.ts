import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../../storage/db";
import { storage } from "../../storage";
import { enforceKindGating, enforcePluginGating } from "../../plugins/_core/gating";
import { oneoffPluginRegistry } from "../../plugins/system/oneoff/registry";
import { getEffectiveUser } from "../masquerade";
import { OneoffRefusal, preflightOneoff, startOneoff, cancelOneoff, oneoffActiveRun } from "../../services/oneoff-runner";
import type { JobRun } from "@shared/schema";

type Auth = (req: Request, res: Response, next: NextFunction) => void | Promise<unknown>;
const actionBody = z.object({
  action: z.string().min(1).max(100),
  input: z.unknown().optional(),
  confirmationToken: z.string().optional(),
});

// The hash is a credential, not part of a public run. Exclude it even from
// administrator history, as a defense against log previews and copied JSON.
function publicRun<T extends JobRun>(run: T): Omit<T, "confirmationHash"> {
  const { confirmationHash: _secret, ...safe } = run;
  return safe;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof OneoffRefusal) {
    res.status(error.statusCode).json({ message: error.message });
  } else {
    res.status(500).json({ message: "Oneoff operation failed" });
  }
}

export function registerOneoffRoutes(app: Express, requireAuth: Auth): void {
  async function resolveKind(req: Request, res: Response): Promise<boolean> {
    const gate = await enforceKindGating({ requiredPolicy: "admin" }, req);
    if (!gate.ok) {
      res.status(gate.status).json({ message: gate.message });
      return false;
    }
    return true;
  }

  async function resolve(req: Request, res: Response) {
    if (!(await resolveKind(req, res))) return null;
    // The same resolved record supplies BOTH authorization and execution data:
    // never check one config and then fall back to another by plugin id.
    const config = await storage.pluginConfigs.get(req.params.id);
    if (!config || config.pluginKind !== "oneoff") {
      res.status(404).json({ message: "Oneoff configuration not found" });
      return null;
    }
    const plugin = oneoffPluginRegistry.get(config.pluginId);
    if (!plugin) {
      res.status(404).json({ message: "Oneoff plugin not registered" });
      return null;
    }
    const gate = await enforcePluginGating(plugin.metadata, req);
    if (!gate.ok) {
      res.status(gate.status).json({ message: gate.message });
      return null;
    }
    if (!config.enabled) {
      res.status(409).json({ message: "Enable this Oneoff configuration before using it" });
      return null;
    }
    return { config, plugin };
  }

  app.get("/api/oneoff/configs/:id/actions", requireAuth, async (req, res) => {
    try {
      const target = await resolve(req, res);
      if (!target) return;
      res.setHeader("Cache-Control", "private, no-store");
      res.json(target.plugin.actions.map(({ id, label, description, destructive, background }) =>
        ({ id, label, description, destructive: !!destructive, background: !!background })));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/oneoff/configs/:id/status", requireAuth, async (req, res) => {
    try {
      const target = await resolve(req, res);
      if (!target) return;
      const [status, activeRun] = await Promise.all([
        target.plugin.status({ config: target.config, db }),
        oneoffActiveRun(target.plugin.metadata.id),
      ]);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        ...status,
        activeRun: activeRun?.configurationId === target.config.id ? publicRun(activeRun) : null,
        blockedByOtherConfiguration: !!activeRun && activeRun.configurationId !== target.config.id,
      });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/oneoff/configs/:id/runs", requireAuth, async (req, res) => {
    try {
      const target = await resolve(req, res);
      if (!target) return;
      res.setHeader("Cache-Control", "private, no-store");
      const runs = await storage.jobRuns.list({ configurationId: target.config.id, pluginKind: "oneoff" });
      res.json(runs.map(publicRun));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/oneoff/runs/:runId", requireAuth, async (req, res) => {
    try {
      if (!(await resolveKind(req, res))) return;
      const run = await storage.jobRuns.getById(req.params.runId);
      if (!run || run.pluginKind !== "oneoff") {
        res.status(404).json({ message: "Run not found" });
        return;
      }
      const plugin = oneoffPluginRegistry.get(run.pluginId);
      if (!plugin) { res.status(404).json({ message: "Plugin not registered" }); return; }
      const gate = await enforcePluginGating(plugin.metadata, req);
      if (!gate.ok) { res.status(gate.status).json({ message: gate.message }); return; }
      res.setHeader("Cache-Control", "private, no-store");
      res.json(publicRun(run));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/oneoff/configs/:id/preflight", requireAuth, async (req, res) => {
    try {
      const target = await resolve(req, res);
      if (!target) return;
      const body = actionBody.safeParse(req.body);
      if (!body.success) { res.status(400).json({ message: "Invalid action or input" }); return; }
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      if (!dbUser) { res.status(401).json({ message: "User not found" }); return; }
      const result = await preflightOneoff(target.config, target.plugin, body.data.action, body.data.input, dbUser.id);
      res.setHeader("Cache-Control", "private, no-store");
      res.json(result);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/oneoff/configs/:id/run", requireAuth, async (req, res) => {
    try {
      const target = await resolve(req, res);
      if (!target) return;
      const body = actionBody.safeParse(req.body);
      if (!body.success) { res.status(400).json({ message: "Invalid action or input" }); return; }
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      if (!dbUser) { res.status(401).json({ message: "User not found" }); return; }
      const run = await startOneoff(target.config, target.plugin, body.data.action, body.data.input, body.data.confirmationToken ?? "", dbUser.id);
      res.status(202).json({ runId: run.id });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/oneoff/runs/:runId/cancel", requireAuth, async (req, res) => {
    try {
      if (!(await resolveKind(req, res))) return;
      const run = await storage.jobRuns.getById(req.params.runId);
      if (!run || run.pluginKind !== "oneoff" || !run.configurationId) {
        res.status(404).json({ message: "Active run not found" }); return;
      }
      req.params.id = run.configurationId;
      const target = await resolve(req, res);
      if (!target || target.plugin.metadata.id !== run.pluginId) return;
      await cancelOneoff(run);
      res.json({ status: "cancellation-requested" });
    } catch (error) { fail(res, error); }
  });
}