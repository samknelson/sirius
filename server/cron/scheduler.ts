import * as cron from 'node-cron';
import { storage } from "../storage";
import type { PluginConfigWithSubsidiary } from "../storage/plugin-configs";
import { logger } from "../logger";
import {
  cronPluginRegistry,
  executeCronPlugin,
} from "../plugins/system/cron";
import { getEnabledComponentIds } from "../modules/components";
import { eventBus, EventType, type PluginConfigSavedPayload } from "../services/event-bus";

/**
 * Normalized view of a cron job the scheduler operates on, projected from a
 * `plugin_configs` + `plugin_configs_cron` envelope. `name` is the plugin id
 * (the stable cron job name that keys `cron_job_runs.jobName`); `settings` is
 * the operator-saved `data`.
 */
interface ScheduledCronJob {
  name: string;
  schedule: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

interface ScheduledJob {
  job: ScheduledCronJob;
  task: cron.ScheduledTask;
}

class CronScheduler {
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private isRunning: boolean = false;
  private configSubscriptionRegistered = false;

  /**
   * Subscribe (once) to cron config saves so edits made through the generic
   * plugin admin modal — which write `plugin_configs` directly and emit
   * `PLUGIN_CONFIG_SAVED` after commit — reschedule live instead of waiting for
   * the next process restart. The legacy `/settings` + `/:name` PATCH routes
   * used to call `reload()` explicitly; that responsibility now lives here so it
   * fires no matter which write path edits a cron config.
   */
  private registerConfigSubscription(): void {
    if (this.configSubscriptionRegistered) return;
    this.configSubscriptionRegistered = true;
    eventBus.on({
      name: 'cron-scheduler:reload-on-config-save',
      description:
        'Reload scheduled cron tasks when a cron plugin config is created, updated, or deleted.',
      event: EventType.PLUGIN_CONFIG_SAVED,
      handler: async (payload: PluginConfigSavedPayload) => {
        if (payload.kind !== 'cron') return;
        await this.reload();
      },
    });
  }

  async start(): Promise<void> {
    this.registerConfigSubscription();

    if (this.isRunning) {
      logger.warn('Cron scheduler is already running', { service: 'cron-scheduler' });
      return;
    }

    logger.info('Starting cron scheduler', { service: 'cron-scheduler' });
    this.isRunning = true;

    try {
      await this.loadAndScheduleJobs();
      logger.info('Cron scheduler started successfully', {
        service: 'cron-scheduler',
        jobCount: this.scheduledJobs.size,
      });
    } catch (error) {
      logger.error('Failed to start cron scheduler', {
        service: 'cron-scheduler',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping cron scheduler', { service: 'cron-scheduler' });

    for (const [jobName, { task }] of Array.from(this.scheduledJobs.entries())) {
      task.stop();
      logger.debug(`Stopped scheduled job: ${jobName}`, { service: 'cron-scheduler' });
    }

    this.scheduledJobs.clear();
    this.isRunning = false;

    logger.info('Cron scheduler stopped', { service: 'cron-scheduler' });
  }

  async reload(): Promise<void> {
    logger.info('Reloading cron scheduler', { service: 'cron-scheduler' });
    await this.stop();
    await this.start();
  }

  private async loadAndScheduleJobs(): Promise<void> {
    const envelopes = await storage.pluginConfigs.search('cron', { enabled: true });
    const jobs = envelopes.map((e) => this.toScheduledJob(e));

    logger.info(`Found ${jobs.length} enabled cron jobs`, { service: 'cron-scheduler' });

    for (const job of jobs) {
      try {
        await this.scheduleJob(job);
      } catch (error) {
        logger.error(`Failed to schedule job: ${job.name}`, {
          service: 'cron-scheduler',
          jobName: job.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Project a plugin-config envelope into the scheduler's normalized job shape. */
  private toScheduledJob(envelope: PluginConfigWithSubsidiary): ScheduledCronJob {
    const subsidiary = envelope.subsidiary as { schedule?: string } | null;
    return {
      name: envelope.config.pluginId,
      schedule: subsidiary?.schedule ?? '',
      enabled: envelope.config.enabled,
      settings: (envelope.config.data as Record<string, unknown>) ?? {},
    };
  }

  private async scheduleJob(job: ScheduledCronJob): Promise<void> {
    // Check if a plugin is registered for this job
    if (!cronPluginRegistry.has(job.name)) {
      logger.warn(`No plugin registered for job: ${job.name}`, {
        service: 'cron-scheduler',
        jobName: job.name,
      });
      return;
    }

    // Validate cron expression
    if (!cron.validate(job.schedule)) {
      logger.error(`Invalid cron expression for job: ${job.name}`, {
        service: 'cron-scheduler',
        jobName: job.name,
        schedule: job.schedule,
      });
      return;
    }

    // Create scheduled task
    const task = cron.schedule(
      job.schedule,
      async () => {
        await this.executeJob(job, false);
      }
    );

    // Start the task immediately
    task.start();

    this.scheduledJobs.set(job.name, { job, task });

    logger.info(`Scheduled job: ${job.name}`, {
      service: 'cron-scheduler',
      jobName: job.name,
      schedule: job.schedule,
    });
  }

  async executeJob(job: ScheduledCronJob, isManual: boolean, triggeredBy?: string, mode: "live" | "test" = "live"): Promise<void> {
    const startedAt = new Date();

    // Create run record - id and startedAt are auto-generated
    const run = await storage.cronJobRuns.create({
      jobName: job.name,
      status: 'running',
      mode,
      triggeredBy: triggeredBy || null,
    });

    const runId = run.id;

    logger.info(`Starting job execution: ${job.name}`, {
      service: 'cron-scheduler',
      jobName: job.name,
      runId,
      isManual,
      triggeredBy,
      mode,
    });

    try {
      // Get the plugin to access default settings + component gating
      const plugin = cronPluginRegistry.get(job.name);

      // Check if job requires a component that is disabled
      const requiredComponent = plugin?.metadata.requiredComponent;
      if (requiredComponent) {
        const enabledComponents = await getEnabledComponentIds();
        if (!enabledComponents.includes(requiredComponent)) {
          const skipMessage = `Skipped: required component '${requiredComponent}' is disabled`;
          logger.info(`Job skipped due to disabled component: ${job.name}`, {
            service: 'cron-scheduler',
            jobName: job.name,
            runId,
            requiredComponent,
          });

          // Update run as skipped
          await storage.cronJobRuns.update(runId, {
            status: 'skipped',
            completedAt: new Date(),
            output: JSON.stringify({ message: skipMessage, requiredComponent }),
          });

          return;
        }
      }

      const defaultSettings = plugin?.getDefaultSettings?.() ?? {};
      const mergedSettings = { ...defaultSettings, ...job.settings };

      // Execute the plugin
      const summary = await executeCronPlugin(job.name, {
        jobId: job.name,
        jobName: job.name,
        triggeredBy,
        isManual,
        mode,
        settings: mergedSettings,
      });

      // Calculate execution time
      const executionTimeMs = Date.now() - startedAt.getTime();

      // Prepare output with execution time and summary
      const outputData = {
        executionTimeMs,
        executionTimeSec: (executionTimeMs / 1000).toFixed(2),
        summary,
      };

      // Update run as successful
      await storage.cronJobRuns.update(runId, {
        status: 'success',
        completedAt: new Date(),
        output: JSON.stringify(outputData),
      });

      logger.info(`Job completed successfully: ${job.name}`, {
        service: 'cron-scheduler',
        jobName: job.name,
        runId,
        duration: executionTimeMs,
        summary,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update run as failed
      await storage.cronJobRuns.update(runId, {
        status: 'error',
        completedAt: new Date(),
        error: errorMessage,
      });

      logger.error(`Job failed: ${job.name}`, {
        service: 'cron-scheduler',
        jobName: job.name,
        runId,
        error: errorMessage,
        duration: Date.now() - startedAt.getTime(),
      });

      throw error;
    }
  }

  async manualRun(jobName: string, triggeredBy?: string, mode: "live" | "test" = "live"): Promise<void> {
    const [config] = await storage.pluginConfigs.getByKindAndPlugin('cron', jobName);

    if (!config) {
      logger.error('Attempted to run non-existent cron job', {
        service: 'cron-scheduler',
        jobName,
      });
      throw new Error(`Cron job not found: ${jobName}`);
    }

    if (!cronPluginRegistry.has(jobName)) {
      logger.error('Attempted to run cron job with no registered plugin', {
        service: 'cron-scheduler',
        jobName,
        availablePlugins: cronPluginRegistry.listIds(),
      });
      throw new Error(
        `No plugin registered for job "${jobName}". ` +
        `Available plugins: ${cronPluginRegistry.listIds().join(', ') || 'none'}`
      );
    }

    const envelope = await storage.pluginConfigs.getWithSubsidiary(config.id);
    const job = this.toScheduledJob(
      envelope ?? { config, subsidiary: null },
    );

    await this.executeJob(job, true, triggeredBy, mode);
  }

  isJobScheduled(jobName: string): boolean {
    return this.scheduledJobs.has(jobName);
  }

  getScheduledJobCount(): number {
    return this.scheduledJobs.size;
  }
}

export const cronScheduler = new CronScheduler();
