import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import type { PluginConfigWithSubsidiary } from "../../storage/plugin-configs";
import { requireAccess } from "../../services/access-policy-evaluator";
import { cronScheduler } from "../../cron";
import { cronPluginRegistry } from "../../plugins/system/cron";
import { runInTransaction } from "../../storage/transaction-context";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Legacy `CronJob` JSON shape the client consumes (see
 * `client/src/lib/cron-types.ts`). Cron jobs now live in `plugin_configs` +
 * `plugin_configs_cron`, but the admin routes keep emitting this flat shape so
 * the existing cron-jobs / cron-job-settings pages need no changes.
 */
interface LegacyCronJob {
  name: string;
  description: string | null;
  schedule: string;
  isEnabled: boolean;
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Project a plugin-config envelope into the legacy flat cron-job shape. */
function toLegacyCronJob(envelope: PluginConfigWithSubsidiary): LegacyCronJob {
  const { config, subsidiary } = envelope;
  const plugin = cronPluginRegistry.get(config.pluginId);
  return {
    name: config.pluginId,
    description: plugin?.metadata.description ?? config.name ?? null,
    schedule: (subsidiary as { schedule?: string } | null)?.schedule ?? "",
    isEnabled: config.enabled,
    settings: (config.data as Record<string, unknown>) ?? null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/** PATCH /api/cron-jobs/:name body — enable/disable, reschedule, or settings. */
const updateCronJobSchema = z
  .object({
    name: z.string().optional(),
    isEnabled: z.boolean().optional(),
    schedule: z.string().min(1).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

export function registerCronJobRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  /**
   * Resolve the single plugin-config envelope for a cron job by its name
   * (= plugin id). Cron plugins are singletons, so there is at most one row.
   */
  async function resolveCronConfig(name: string): Promise<PluginConfigWithSubsidiary | undefined> {
    const [config] = await storage.pluginConfigs.getByKindAndPlugin("cron", name);
    if (!config) return undefined;
    return storage.pluginConfigs.getWithSubsidiary(config.id);
  }

  // GET /api/cron-jobs - List all cron jobs
  app.get("/api/cron-jobs", requireAccess('admin'), async (req, res) => {
    try {
      const configs = await storage.pluginConfigs.getByKind("cron");

      const jobsWithRuns = await Promise.all(configs.map(async (config) => {
        const envelope = await storage.pluginConfigs.getWithSubsidiary(config.id);
        const job = toLegacyCronJob(envelope ?? { config, subsidiary: null });
        const latestRun = await storage.cronJobRuns.getLatestByJobName(job.name);
        return { ...job, latestRun };
      }));

      res.json(jobsWithRuns);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron jobs" });
    }
  });

  // GET /api/cron-jobs/:name - Get a specific cron job with latest run
  app.get("/api/cron-jobs/:name", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const envelope = await resolveCronConfig(name);

      if (!envelope) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const job = toLegacyCronJob(envelope);
      const latestRun = await storage.cronJobRuns.getLatestByJobName(name);

      // Get plugin metadata for settings
      const plugin = cronPluginRegistry.get(name);
      const settingsFields = plugin?.getSettingsFields?.() ?? null;
      const defaultSettings = plugin?.getDefaultSettings?.() ?? {};

      res.json({
        ...job,
        latestRun,
        settingsFields,
        defaultSettings
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job" });
    }
  });

  // GET /api/cron-jobs/:name/runs - Get run history for a specific job
  app.get("/api/cron-jobs/:name/runs", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const envelope = await resolveCronConfig(name);

      if (!envelope) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const runs = await storage.cronJobRuns.list({ jobName: name });
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job runs" });
    }
  });

  // PATCH /api/cron-jobs/:name - Update a cron job (enable/disable, reschedule)
  app.patch("/api/cron-jobs/:name", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;

      const envelope = await resolveCronConfig(name);
      if (!envelope) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const validatedData = updateCronJobSchema.parse(req.body);

      // Prevent renaming via this endpoint (name is the stable plugin id)
      if (validatedData.name && validatedData.name !== name) {
        return res.status(400).json({ message: "Cannot change job name (it is the primary key)" });
      }

      await runInTransaction(async () => {
        if (validatedData.isEnabled !== undefined) {
          await storage.pluginConfigs.update(envelope.config.id, {
            enabled: validatedData.isEnabled,
          });
        }
        if (validatedData.schedule !== undefined) {
          await storage.pluginConfigs.upsertSubsidiary("cron", {
            id: envelope.config.id,
            schedule: validatedData.schedule,
          });
        }
        if (validatedData.settings !== undefined) {
          await storage.pluginConfigs.update(envelope.config.id, {
            data: validatedData.settings,
          });
        }
      });

      const updated = await storage.pluginConfigs.getWithSubsidiary(envelope.config.id);
      res.json(toLegacyCronJob(updated ?? envelope));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid cron job data", error });
      } else {
        res.status(500).json({ message: "Failed to update cron job" });
      }
    }
  });

  // POST /api/cron-jobs/:name/run - Manually trigger a cron job
  app.post("/api/cron-jobs/:name/run", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const { mode = "live" } = req.body; // Accept mode from request body, default to "live"
      const user = req.user as any;

      // Validate mode parameter
      if (mode !== "live" && mode !== "test") {
        return res.status(400).json({ message: "Invalid mode. Must be 'live' or 'test'" });
      }

      const envelope = await resolveCronConfig(name);
      if (!envelope) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      // Get the user ID for audit trail via resolveDbUser helper
      const { resolveDbUser } = await import("../../auth/helpers");
      const dbUser = await resolveDbUser(user, user?.claims?.sub);
      if (!dbUser) {
        return res.status(401).json({ message: "User not found" });
      }

      // Execute the job via the scheduler (which handles run creation and logging)
      await cronScheduler.manualRun(name, dbUser.id, mode);

      // Get the latest run for this job to return to the client
      const latestRun = await storage.cronJobRuns.getLatestByJobName(name);

      res.status(201).json(latestRun);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to run cron job"
      });
    }
  });

  // GET /api/cron-jobs/:name/settings - Get settings with adapter support
  app.get("/api/cron-jobs/:name/settings", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const envelope = await resolveCronConfig(name);

      if (!envelope) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const plugin = cronPluginRegistry.get(name);
      if (!plugin) {
        return res.status(404).json({ message: "Cron job handler not found" });
      }

      const currentSettings = (envelope.config.data as Record<string, unknown>) ?? {};
      const defaultSettings = plugin.getDefaultSettings?.() ?? {};
      const mergedSettings = { ...defaultSettings, ...currentSettings };

      // Check if plugin has a custom settings adapter
      if (plugin.settingsAdapter) {
        const { clientState, values } = await plugin.settingsAdapter.loadClientState(mergedSettings);
        return res.json({
          mode: 'custom',
          componentId: plugin.settingsAdapter.componentId,
          clientState,
          values,
        });
      }

      // Fall back to standard fields mode
      const settingsFields = plugin.getSettingsFields?.() ?? [];
      return res.json({
        mode: 'fields',
        fields: settingsFields,
        values: mergedSettings,
        defaultSettings,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch cron job settings" });
    }
  });

  // PATCH /api/cron-jobs/:name/settings - Update settings with adapter support
  app.patch("/api/cron-jobs/:name/settings", requireAccess('admin'), async (req, res) => {
    try {
      const { name } = req.params;
      const envelope = await resolveCronConfig(name);

      if (!envelope) {
        return res.status(404).json({ message: "Cron job not found" });
      }

      const plugin = cronPluginRegistry.get(name);
      if (!plugin) {
        return res.status(404).json({ message: "Cron job handler not found" });
      }

      let newSettings: Record<string, unknown>;

      // Check if plugin has a custom settings adapter
      if (plugin.settingsAdapter) {
        newSettings = await plugin.settingsAdapter.applyUpdate(req.body);
      } else {
        // Standard settings - validate with schema if available
        if (plugin.settingsSchema) {
          newSettings = plugin.settingsSchema.parse(req.body) as Record<string, unknown>;
        } else {
          newSettings = req.body;
        }
      }

      await storage.pluginConfigs.update(envelope.config.id, { data: newSettings });
      const updated = await storage.pluginConfigs.getWithSubsidiary(envelope.config.id);
      res.json(toLegacyCronJob(updated ?? envelope));
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid settings data", error });
      } else {
        res.status(500).json({
          message: error instanceof Error ? error.message : "Failed to update cron job settings"
        });
      }
    }
  });
}
