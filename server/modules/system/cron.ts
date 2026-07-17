import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import type { PluginConfigWithSubsidiary } from "../../storage/system/plugin-configs";
import { requireAccess } from "../../services/access-policy-evaluator";
import { cronScheduler } from "../../cron";
import { cronPluginRegistry } from "../../plugins/system/cron";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Legacy `CronJob` JSON shape the client consumes (see
 * `client/src/lib/cron-types.ts`). Cron jobs now live in `plugin_configs` +
 * `plugin_configs_cron`, but the admin routes keep emitting this flat shape so
 * the cron-jobs list, view, and run pages need no changes. Editing schedule /
 * enabled / settings now happens through the generic plugin admin modal.
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

      // Surface the plugin's default settings so read-only views can render the
      // effective config (defaults overlaid with the saved `data`). Editing now
      // happens through the generic plugin admin modal, not here.
      const plugin = cronPluginRegistry.get(name);
      const defaultSettings = plugin?.getDefaultSettings?.() ?? {};

      res.json({
        ...job,
        latestRun,
        defaultSettings,
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
}
