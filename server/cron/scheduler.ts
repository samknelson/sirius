import * as cron from 'node-cron';
import { storage } from "../storage";
import type { PluginConfigWithSubsidiary } from "../storage/system/plugin-configs";
import { logger } from "../logger";
import {
  cronPluginRegistry,
  executeCronPlugin,
} from "../plugins/system/cron";
import { getEnabledComponentIds } from "../modules/components";
import { readConfigurationSnapshot } from "../storage/configuration-revisions";

/**
 * Normalized view of a cron job the scheduler operates on, projected from a
 * `plugin_configs` + `plugin_configs_cron` envelope. `name` is the plugin id
 * (the stable cron plugin id); the configuration id identifies the particular
 * configured instance, and `settings` is the operator-saved `data`.
 */
interface ScheduledCronJob {
  configurationId: string;
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
  private ownsWork = false;
  private snapshotGeneration = 0;
  private reloadFlight?: Promise<void>;
  private scheduleWarnings: string[] = [];

  setOwnership(ownsWork: boolean): void { this.ownsWork = ownsWork; }
  isStarted(): boolean { return this.isRunning; }
  invalidateSnapshot(): void { this.snapshotGeneration++; }
  getScheduleSummary(): string {
    const count = this.scheduledJobs.size;
    return `${count} job${count === 1 ? "" : "s"} scheduled.` +
      (this.scheduleWarnings.length ? ` Skipped jobs: ${this.scheduleWarnings.join("; ")}.` : "");
  }

  async start(): Promise<void> {
    if (!this.ownsWork) return;

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
      // A failed load may already have scheduled some jobs. Return to a clean
      // stopped state so a deferred maintenance-exit retry can really start.
      await this.stop();
      logger.error('Failed to start cron scheduler', {
        service: 'cron-scheduler',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.invalidateSnapshot();
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping cron scheduler', { service: 'cron-scheduler' });

    for (const [jobName, { task }] of Array.from(this.scheduledJobs.entries())) {
      task.destroy();
      logger.debug(`Stopped scheduled job: ${jobName}`, { service: 'cron-scheduler' });
    }

    this.scheduledJobs.clear();
    this.isRunning = false;

    logger.info('Cron scheduler stopped', { service: 'cron-scheduler' });
  }

  async reload(): Promise<void> {
    // A selected reload must never start cron in a non-owning API role, or
    // bypass the existing maintenance-startup deferral.
    if (!this.ownsWork || !this.isRunning) return;
    logger.info('Reloading cron scheduler', { service: 'cron-scheduler' });
    this.invalidateSnapshot();
    await this.loadAndScheduleJobs();
  }

  private async loadAndScheduleJobs(): Promise<void> {
    if (this.reloadFlight) return this.reloadFlight;
    const work = (async () => {
      while (this.isRunning) {
        const generation = this.snapshotGeneration;
        const envelopes = await readConfigurationSnapshot(() => storage.pluginConfigs.search('cron', { enabled: true }));
        if (!this.isRunning) return;
        if (generation !== this.snapshotGeneration) continue;
        const next = new Map<string, ScheduledJob>();
        const warnings: string[] = [];
        for (const envelope of envelopes) {
          const job = this.toScheduledJob(envelope);
          try {
            const task = this.scheduleJob(job, warnings);
            if (task) next.set(job.configurationId, { job, task });
          } catch (error) {
            // Persisted bad job configuration is isolated, not a failure to
            // obtain an authoritative snapshot. Healthy jobs still refresh.
            const message = `${job.name}: ${error instanceof Error ? error.message : String(error)}`;
            warnings.push(message);
            logger.error("Failed to schedule cron job; skipping it", {
              service: "cron-scheduler", jobName: job.name, message,
            });
          }
        }
        // No awaits between the generation check and publication. A failed
        // snapshot leaves the last confirmed schedule intact, pending retry.
        for (const { task } of this.scheduledJobs.values()) task.destroy();
        this.scheduledJobs = next;
        for (const [id, { job, task }] of next) {
          try { task.start(); }
          catch (error) {
            task.destroy();
            next.delete(id);
            warnings.push(`${job.name}: ${error instanceof Error ? error.message : String(error)}`);
            logger.error("Failed to start scheduled cron job; skipping it", {
              service: "cron-scheduler", jobName: job.name,
            });
          }
        }
        this.scheduleWarnings = warnings;
        return;
      }
    })();
    this.reloadFlight = work;
    try { await work; } finally { this.reloadFlight = undefined; }
  }

  /** Project a plugin-config envelope into the scheduler's normalized job shape. */
  private toScheduledJob(envelope: PluginConfigWithSubsidiary): ScheduledCronJob {
    const subsidiary = envelope.subsidiary as { schedule?: string } | null;
    return {
      configurationId: envelope.config.id,
      name: envelope.config.pluginId,
      schedule: subsidiary?.schedule ?? '',
      enabled: envelope.config.enabled,
      settings: (envelope.config.data as Record<string, unknown>) ?? {},
    };
  }

  private scheduleJob(job: ScheduledCronJob, warnings: string[]): cron.ScheduledTask | undefined {
    // Check if a plugin is registered for this job
    if (!cronPluginRegistry.has(job.name)) {
      warnings.push(`${job.name}: no registered plugin`);
      logger.warn(`No plugin registered for job: ${job.name}`, {
        service: 'cron-scheduler',
        jobName: job.name,
      });
      return;
    }

    // Validate cron expression
    if (!cron.validate(job.schedule)) {
      warnings.push(`${job.name}: invalid cron expression`);
      logger.error("Invalid cron expression; skipping job", {
        service: "cron-scheduler", jobName: job.name, schedule: job.schedule,
      });
      return;
    }

    // Create scheduled task
    const task = cron.createTask(
      job.schedule,
      async () => {
        await this.executeJob(job, false);
      }
    );

    logger.info(`Scheduled job: ${job.name}`, {
      service: 'cron-scheduler',
      jobName: job.name,
      schedule: job.schedule,
    });
    return task;
  }

  async executeJob(job: ScheduledCronJob, isManual: boolean, triggeredBy?: string, mode: "live" | "test" = "live"): Promise<string> {
    const startedAt = new Date();

    // Create run record - id and startedAt are auto-generated
    const run = await storage.jobRuns.create({
      configurationId: job.configurationId,
      pluginKind: "cron",
      pluginId: job.name,
      operation: "execute",
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
          await storage.jobRuns.update(runId, {
            status: 'skipped',
            completedAt: new Date(),
            output: JSON.stringify({ message: skipMessage, requiredComponent }),
          });

          return runId;
        }
      }

      const defaultSettings = plugin?.getDefaultSettings?.() ?? {};
      const mergedSettings = { ...defaultSettings, ...job.settings };

      // Execute the plugin
      const summary = await executeCronPlugin(job.name, {
        configurationId: job.configurationId,
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
      await storage.jobRuns.update(runId, {
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
      return runId;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update run as failed
      await storage.jobRuns.update(runId, {
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

  async manualRun(configurationId: string, triggeredBy?: string, mode: "live" | "test" = "live"): Promise<string> {
    const envelope = await storage.pluginConfigs.getWithSubsidiary(configurationId);
    if (!envelope || envelope.config.pluginKind !== "cron") {
      logger.error('Attempted to run non-existent cron job', {
        service: 'cron-scheduler',
        configurationId,
      });
      throw new Error(`Cron job not found for configuration: ${configurationId}`);
    }

    const jobName = envelope.config.pluginId;
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

    return this.executeJob(this.toScheduledJob(envelope), true, triggeredBy, mode);
  }

  isJobScheduled(jobName: string): boolean {
    return Array.from(this.scheduledJobs.values()).some(({ job }) => job.name === jobName);
  }

  getScheduledJobCount(): number {
    return this.scheduledJobs.size;
  }
}

export const cronScheduler = new CronScheduler();
