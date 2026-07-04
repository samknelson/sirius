import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { validateAgainstSchema } from "../../lib/json-schema-validator";
import { enforcePluginGating } from "../_core";
import { wizardPluginRegistry } from "./registry";
import { enforceWizardEntityAccess } from "./entity-access";
import type {
  WizardPlugin,
  WizardStepHandler,
  WizardStepContext,
  WizardStepResult,
} from "./types";
import type { Wizard } from "@shared/schema";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;

const SERVICE = "wizard-dispatcher";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * Load the wizard, confirm it is driven by a registered wizard plugin,
 * and enforce PLUGIN-LEVEL gating (component → access policy). This is
 * the single choke point every dispatch route funnels through, so the
 * plugin-level answer to "who can reach this wizard?" lives here.
 */
async function loadRegisteredWizard(
  req: Request,
  res: Response,
): Promise<{ wizard: Wizard; plugin: WizardPlugin } | null> {
  const wizard = await storage.wizards.getById(req.params.id);
  if (!wizard) {
    res.status(404).json({ message: "Wizard not found" });
    return null;
  }
  const plugin = wizardPluginRegistry.get(wizard.type);
  if (!plugin) {
    res
      .status(404)
      .json({ message: "This wizard is not a framework wizard" });
    return null;
  }
  const gate = await enforcePluginGating(
    wizardPluginRegistry.getMetadata(plugin),
    req,
  );
  if (!gate.ok) {
    res.status(gate.status).json({ message: gate.message });
    return null;
  }
  // Entity-scoped wizards (e.g. employer feeds) must additionally be scoped
  // to the owning entity's users — the plugin-level gate above does not do
  // this. Non-entity wizards skip it and keep their plugin-level gating.
  if (plugin.entityType) {
    const entityGate = await enforceWizardEntityAccess(
      plugin,
      wizard.entityId,
      req,
    );
    if (!entityGate.ok) {
      res.status(entityGate.status).json({ message: entityGate.message });
      return null;
    }
  }
  return { wizard, plugin };
}

/**
 * Resolve the step and enforce STEP-LEVEL gating. Together with
 * `loadRegisteredWizard`, this is the full picture a reviewer reads to
 * answer "who can invoke this step?" — the plugin gate, the step gate,
 * and the step's own `requiredComponent` / `requiredPolicy` declaration.
 */
async function resolveStep(
  plugin: WizardPlugin,
  stepId: string,
  req: Request,
  res: Response,
): Promise<WizardStepHandler | null> {
  const step = wizardPluginRegistry.getStep(plugin, stepId);
  if (!step) {
    res.status(404).json({ message: `Step '${stepId}' not found` });
    return null;
  }
  if (step.requiredComponent || step.requiredPolicy) {
    const gate = await enforcePluginGating(
      {
        id: `${plugin.id}:${step.id}`,
        name: step.name,
        description: step.description ?? "",
        requiredComponent: step.requiredComponent,
        requiredPolicy: step.requiredPolicy,
      },
      req,
    );
    if (!gate.ok) {
      res.status(gate.status).json({ message: gate.message });
      return null;
    }
  }
  return step;
}

function buildStepContext(
  wizard: Wizard,
  stepId: string,
  input: Record<string, unknown>,
  req: Request,
  file?: WizardStepContext["file"],
): WizardStepContext {
  return {
    wizardId: wizard.id,
    wizard,
    input,
    file,
    req,
    storage,
    reportProgress: async (percentComplete: number) => {
      // Guard against a late-landing progress write (plugins may fire
      // these without awaiting) resurrecting a step that has already
      // reached a terminal state — otherwise the poller spins forever.
      const fresh = await storage.wizards.getById(wizard.id);
      if (!fresh) return;
      const data: any = fresh.data || {};
      const current = data.progress?.[stepId]?.status;
      if (current === "completed" || current === "failed") return;
      data.progress = data.progress || {};
      data.progress[stepId] = {
        ...data.progress[stepId],
        status: "in_progress",
        percentComplete,
      };
      await storage.wizards.update(wizard.id, { data });
    },
  };
}

/**
 * Read-modify-write a single step's progress entry. `storage.wizards.update`
 * replaces the `data` jsonb wholesale, so every mutation reloads first.
 */
async function patchProgress(
  wizardId: string,
  stepId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const fresh = await storage.wizards.getById(wizardId);
  if (!fresh) return;
  const data: any = fresh.data || {};
  data.progress = data.progress || {};
  data.progress[stepId] = { ...data.progress[stepId], ...patch };
  await storage.wizards.update(wizardId, { data });
}

/**
 * Persist the result of a synchronous step: shallow-merge `result.data`
 * into the top level of `wizard.data`, mark the step completed, and
 * optionally bump the wizard status.
 */
async function persistStepResult(
  wizardId: string,
  stepId: string,
  result: WizardStepResult | void,
): Promise<Wizard | undefined> {
  const fresh = await storage.wizards.getById(wizardId);
  const data: any = fresh?.data || {};
  if (result && result.data) Object.assign(data, result.data);
  data.progress = data.progress || {};
  data.progress[stepId] = {
    ...data.progress[stepId],
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  const updates: Record<string, unknown> = { data };
  if (result && result.status) updates.status = result.status;
  return storage.wizards.update(wizardId, updates);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Register the FIXED wizard dispatcher route set. Adding a wizard plugin
 * adds ZERO routes — every wizard is driven through these endpoints.
 */
export function registerWizardDispatcherRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
): void {
  // form / review steps
  app.post(
    "/api/wizards/:id/dispatch/:stepId/submit",
    requireAuth,
    async (req, res) => {
      try {
        const loaded = await loadRegisteredWizard(req, res);
        if (!loaded) return;
        const step = await resolveStep(
          loaded.plugin,
          req.params.stepId,
          req,
          res,
        );
        if (!step) return;
        if (!step.submit) {
          return res
            .status(400)
            .json({ message: `Step '${step.id}' does not support submit` });
        }
        const input = (req.body?.input ?? {}) as Record<string, unknown>;
        const schema = step.getSchema
          ? step.getSchema(loaded.wizard)
          : step.schema;
        if (schema) {
          const result = validateAgainstSchema(schema, input);
          if (!result.valid) {
            return res
              .status(400)
              .json({ message: "Invalid input", errors: result.errors });
          }
        }
        const ctx = buildStepContext(loaded.wizard, step.id, input, req);
        const out = await step.submit(ctx);
        const updated = await persistStepResult(loaded.wizard.id, step.id, out);
        res.json(updated);
      } catch (error) {
        logger.error("Wizard dispatch submit failed", {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
          message:
            error instanceof Error ? error.message : "Failed to submit step",
        });
      }
    },
  );

  // upload steps
  app.post(
    "/api/wizards/:id/dispatch/:stepId/upload",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const loaded = await loadRegisteredWizard(req, res);
        if (!loaded) return;
        const step = await resolveStep(
          loaded.plugin,
          req.params.stepId,
          req,
          res,
        );
        if (!step) return;
        if (!step.submit) {
          return res
            .status(400)
            .json({ message: `Step '${step.id}' does not support upload` });
        }
        const file = req.file
          ? {
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
              buffer: req.file.buffer,
            }
          : undefined;
        if (!file) {
          return res.status(400).json({ message: "No file uploaded" });
        }
        const ctx = buildStepContext(loaded.wizard, step.id, {}, req, file);
        const out = await step.submit(ctx);
        const updated = await persistStepResult(loaded.wizard.id, step.id, out);
        res.json(updated);
      } catch (error) {
        logger.error("Wizard dispatch upload failed", {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({
          message:
            error instanceof Error ? error.message : "Failed to upload",
        });
      }
    },
  );

  // run steps — async; progress polled off the load route, no bespoke poll route
  app.post(
    "/api/wizards/:id/dispatch/:stepId/run",
    requireAuth,
    async (req, res) => {
      const loaded = await loadRegisteredWizard(req, res);
      if (!loaded) return;
      const step = await resolveStep(
        loaded.plugin,
        req.params.stepId,
        req,
        res,
      );
      if (!step) return;
      if (!step.run) {
        return res
          .status(400)
          .json({ message: `Step '${step.id}' does not support run` });
      }

      await patchProgress(loaded.wizard.id, step.id, {
        status: "in_progress",
        percentComplete: 0,
        error: undefined,
      });
      // Kick off the work and respond immediately.
      res.status(202).json({ started: true });

      const input = (req.body?.input ?? {}) as Record<string, unknown>;
      void (async () => {
        try {
          const fresh = await storage.wizards.getById(loaded.wizard.id);
          if (!fresh) return;
          const ctx = buildStepContext(fresh, step.id, input, req);
          const out = await step.run!(ctx);
          const after = await storage.wizards.getById(loaded.wizard.id);
          const data: any = after?.data || {};
          if (out && out.data) Object.assign(data, out.data);
          data.progress = data.progress || {};
          data.progress[step.id] = {
            ...data.progress[step.id],
            status: "completed",
            completedAt: new Date().toISOString(),
            percentComplete: 100,
          };
          const updates: Record<string, unknown> = { data };
          if (out && out.status) updates.status = out.status;
          await storage.wizards.update(loaded.wizard.id, updates);
        } catch (error) {
          logger.error("Wizard dispatch run failed", {
            service: SERVICE,
            wizardId: loaded.wizard.id,
            step: step.id,
            error: error instanceof Error ? error.message : String(error),
          });
          await patchProgress(loaded.wizard.id, step.id, {
            status: "failed",
            error:
              error instanceof Error ? error.message : "Run failed",
          });
        }
      })();
    },
  );

  // read step output (columns + rows) for results-style steps
  app.get(
    "/api/wizards/:id/dispatch/:stepId/data",
    requireAuth,
    async (req, res) => {
      try {
        const loaded = await loadRegisteredWizard(req, res);
        if (!loaded) return;
        const step = await resolveStep(
          loaded.plugin,
          req.params.stepId,
          req,
          res,
        );
        if (!step) return;
        // A step opts into exposing data by defining `getData`; the
        // dispatcher returns its payload verbatim. Otherwise only a
        // `results` step exposes data (from the persisted report rows).
        // This keeps the "who can invoke this step?" answer honest: a
        // laxer step cannot be used to read results a stricter `results`
        // step would gate unless it explicitly opts in.
        if (step.getData) {
          const ctx = buildStepContext(loaded.wizard, step.id, {}, req);
          const payload = await step.getData(ctx);
          return res.json(payload);
        }
        if (step.kind !== "results") {
          return res
            .status(400)
            .json({ message: `Step '${step.id}' does not expose results` });
        }
        const data: any = loaded.wizard.data || {};
        const reportMeta = data.reportMeta ?? null;
        const rows = await storage.wizards.getReportData(loaded.wizard.id);
        res.json({
          reportMeta,
          columns: reportMeta?.columns ?? [],
          records: rows.map((r) => r.data),
          recordCount: reportMeta?.recordCount ?? rows.length,
        });
      } catch (error) {
        logger.error("Wizard dispatch data read failed", {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to read step data" });
      }
    },
  );

  // CSV export for results-style steps
  app.get(
    "/api/wizards/:id/dispatch/:stepId/export",
    requireAuth,
    async (req, res) => {
      try {
        const loaded = await loadRegisteredWizard(req, res);
        if (!loaded) return;
        const step = await resolveStep(
          loaded.plugin,
          req.params.stepId,
          req,
          res,
        );
        if (!step) return;
        let columns: Array<{ id: string; header: string; type?: string }>;
        let rows: Array<Record<string, unknown>>;
        // Mirror the data route: a `getData` step builds the CSV from its
        // returned { columns, records }; otherwise fall back to the
        // persisted report rows of a `results` step.
        if (step.getData) {
          const ctx = buildStepContext(loaded.wizard, step.id, {}, req);
          const payload = (await step.getData(ctx)) as {
            columns?: Array<{ id: string; header: string; type?: string }>;
            records?: Array<Record<string, unknown>>;
          };
          columns = payload.columns ?? [];
          rows = payload.records ?? [];
        } else if (step.kind === "results") {
          const data: any = loaded.wizard.data || {};
          columns = data.reportMeta?.columns ?? [];
          rows = (
            await storage.wizards.getReportData(loaded.wizard.id)
          ).map((r) => r.data as Record<string, unknown>);
        } else {
          return res
            .status(400)
            .json({ message: `Step '${step.id}' does not expose results` });
        }
        // Action / link columns hold a UI-only object or id (e.g. a
        // `{ url, label }` link or a `viewLink` action) that has no
        // meaningful CSV representation. Drop them from the export, matching
        // the legacy report ResultsStep behavior.
        const exportColumns = columns.filter(
          (c) => c.id !== "viewLink" && c.type !== "link",
        );
        const header = exportColumns.map((c) => csvEscape(c.header)).join(",");
        const body = rows
          .map((row) =>
            exportColumns.map((c) => csvEscape(row?.[c.id])).join(","),
          )
          .join("\n");
        const csv = exportColumns.length ? `${header}\n${body}` : "";
        const filename = `${loaded.plugin.id}-${loaded.wizard.id}.csv`;
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.send(csv);
      } catch (error) {
        logger.error("Wizard dispatch export failed", {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to export" });
      }
    },
  );

  // step navigation (next / previous) — centrally validates + persists
  app.post(
    "/api/wizards/:id/dispatch/navigate",
    requireAuth,
    async (req, res) => {
      try {
        const loaded = await loadRegisteredWizard(req, res);
        if (!loaded) return;
        const { plugin } = loaded;
        // Re-read fresh: an async run may have written progress since the
        // wizard was loaded, and `storage.wizards.update` replaces `data`
        // wholesale, so navigating off a stale snapshot would clobber it.
        const wizard = await storage.wizards.getById(loaded.wizard.id);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }
        const direction = req.body?.direction;
        const steps = plugin.steps;
        const currentId = wizard.currentStep || steps[0]?.id;
        const idx = steps.findIndex((s) => s.id === currentId);
        if (idx === -1) {
          return res
            .status(400)
            .json({ message: "Current step not found in wizard" });
        }
        const data: any = wizard.data || {};
        data.progress = data.progress || {};

        if (direction === "next") {
          if (idx >= steps.length - 1) {
            return res.status(400).json({ message: "Already on last step" });
          }
          const state = wizardPluginRegistry.stepState(
            plugin,
            steps[idx],
            wizard,
          );
          if (state !== "completed") {
            return res.status(400).json({
              message: "Complete the current step before proceeding",
            });
          }
          const next = steps[idx + 1];
          data.progress[currentId] = {
            ...data.progress[currentId],
            status: "completed",
            completedAt: new Date().toISOString(),
          };
          if (data.progress[next.id]?.status !== "completed") {
            data.progress[next.id] = {
              ...data.progress[next.id],
              status: "in_progress",
            };
          }
          const updated = await storage.wizards.update(wizard.id, {
            currentStep: next.id,
            data,
          });
          return res.json(updated);
        }

        if (direction === "previous") {
          if (idx <= 0) {
            return res.status(400).json({ message: "Already on first step" });
          }
          const prev = steps[idx - 1];
          data.progress[prev.id] = {
            ...data.progress[prev.id],
            status: "in_progress",
          };
          const updated = await storage.wizards.update(wizard.id, {
            currentStep: prev.id,
            data,
          });
          return res.json(updated);
        }

        return res.status(400).json({ message: "Invalid direction" });
      } catch (error) {
        logger.error("Wizard dispatch navigate failed", {
          service: SERVICE,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to navigate" });
      }
    },
  );
}
