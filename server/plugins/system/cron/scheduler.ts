import * as cron from 'node-cron';
import { storage } from "../../../storage";
import type { PluginConfigWithSubsidiary } from "../../../storage/system/plugin-configs";
import { logger } from "../../../logger";
import {
  cronPluginRegistry,
  executeCronPlugin,
} from "./registry";
import { getEnabledComponentIds } from "../../../modules/components";
import { readConfigurationSnapshot } from "../../../storage/configuration-revisions";
import { isMaintenanceActive } from "../../../services/maintenance-flag";
import { CronOwnership } from "./ownership";
import { CronExecutionLock, CronExecutionLost } from "./execution-lock";

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

export class CronScheduler {
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private isRunning: boolean = false;
  private ownsWork = false;
  private snapshotGeneration = 0;
  private reloadFlight?: { token: number; promise: Promise<void> };
  private scheduleWarnings: string[] = [];
  private readonly ownership = new CronOwnership({
    acquired: async token => {
      if (this.ownership.owns(token)) await this.loadAndScheduleJobs(token);
    },
    lost: () => this.clearSchedules(),
    report: (event, error) => {
      const message = {
        acquired: "Cron scheduler ownership acquired",
        standby: "Cron scheduler on standby; another process owns scheduling",
        lost: "Cron scheduler ownership lost; automatic scheduling stopped",
        error: "Cron scheduler ownership unavailable; will retry",
      }[event];
      const meta = { service: "cron-scheduler", ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) };
      if (event === "lost" || event === "error") logger.warn(message, meta);
      else logger.info(message, meta);
    },
  });

  setOwnership(ownsWork: boolean): void {
    this.ownsWork = ownsWork;
    if (!ownsWork) void this.stop();
  }
  isStarted(): boolean { return this.isRunning; }
  invalidateSnapshot(): void { this.snapshotGeneration++; }
  getScheduleSummary(): string {
    if (this.isRunning && this.ownership.token === undefined) {
      return "Cron scheduler on standby; waiting for database-backed ownership. No jobs scheduled here.";
    }
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

    // Election and standby waits must not hold up application readiness.
    this.ownership.start();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    await this.ownership.stop();
  }

  private clearSchedules(): void {
    this.invalidateSnapshot();
    for (const { task } of this.scheduledJobs.values()) task.destroy();
    this.scheduledJobs.clear();
    this.scheduleWarnings = [];
  }

  async reload(): Promise<void> {
    // A selected reload must never start cron in a non-owning API role, or
    // bypass the existing maintenance-startup deferral.
    if (!this.ownsWork || !this.isRunning) return;
    const token = this.ownership.token;
    if (token === undefined) return; // the next takeover reads current storage
    logger.info('Reloading cron scheduler', { service: 'cron-scheduler' });
    this.invalidateSnapshot();
    await this.loadAndScheduleJobs(token);
  }

  private async loadAndScheduleJobs(token: number): Promise<void> {
    if (this.reloadFlight?.token === token) return this.reloadFlight.promise;
    const work = (async () => {
      while (this.isRunning && this.ownership.owns(token)) {
        const generation = this.snapshotGeneration;
        const envelopes = await readConfigurationSnapshot(() => storage.pluginConfigs.search('cron', { enabled: true }));
        if (!this.isRunning || !this.ownership.owns(token)) return;
        if (generation !== this.snapshotGeneration) continue;
        const next = new Map<string, ScheduledJob>();
        const warnings: string[] = [];
        for (const envelope of envelopes) {
          const job = this.toScheduledJob(envelope);
          try {
            const task = this.scheduleJob(job, warnings, token);
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
    const flight = { token, promise: work };
    this.reloadFlight = flight;
    try { await work; } finally {
      if (this.reloadFlight === flight) this.reloadFlight = undefined;
    }
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

  private scheduleJob(job: ScheduledCronJob, warnings: string[], token: number): cron.ScheduledTask | undefined {
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
        const authorized = () => this.isRunning && this.ownership.owns(token) &&
          this.scheduledJobs.get(job.configurationId)?.task === task && !isMaintenanceActive();
        // Destroyed timers can already have callbacks queued in the event loop.
        if (!authorized()) return;
        await this.executeJob(job, false, undefined, "live", authorized);
      }
    );

    logger.info(`Scheduled job: ${job.name}`, {
      service: 'cron-scheduler',
      jobName: job.name,
      schedule: job.schedule,
    });
    return task;
  }

  async executeJob(job: ScheduledCronJob, isManual: boolean, triggeredBy?: string, mode: "live" | "test" = "live", authorized: () => boolean = () => true): Promise<string> {
    const startedAt = new Date();
    const runDetails = {
      configurationId: job.configurationId,
      pluginKind: "cron" as const,
      pluginId: job.name,
      operation: "execute",
      mode,
      triggeredBy: triggeredBy || null,
    };

    let executionLock: CronExecutionLock | null = null;
    let runId: string | undefined;
    try {
      // No contender may publish running history before owning the lock:
      // otherwise recovery could interrupt a delayed contender which then
      // acquires the lock and executes that very same run.
      executionLock = await CronExecutionLock.acquire(job.name);
      const run = executionLock
        ? await executionLock.whileOwned(async owner => {
          const admitted = await storage.jobRuns.create({ ...runDetails, status: "running" }, owner);
          runId = admitted.id;
          return admitted;
        })
        : await storage.jobRuns.create({
          ...runDetails, status: "skipped", completedAt: new Date(),
          output: JSON.stringify({ message: "Skipped: job already running." }),
        });
      runId = run.id;
      if (!executionLock) {
        logger.info(`Job skipped: ${job.name} already running`, { service: "cron-scheduler", jobName: job.name, runId });
        return runId;
      }
      logger.info(`Starting job execution: ${job.name}`, {
        service: "cron-scheduler", jobName: job.name, runId, isManual, triggeredBy, mode,
      });

      const skipLostOwnership = async () => {
        if (isManual || authorized()) return false;
        await executionLock!.whileOwned(owner => storage.jobRuns.update(run.id, {
          status: "skipped", completedAt: new Date(),
          output: JSON.stringify({ message: "Skipped: automatic scheduling authority changed before execution." }),
        }, owner));
        return true;
      };
      if (!isManual && !authorized()) {
        await skipLostOwnership();
        return runId;
      }
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
          await executionLock.whileOwned(owner => storage.jobRuns.update(run.id, {
            status: 'skipped',
            completedAt: new Date(),
            output: JSON.stringify({ message: skipMessage, requiredComponent }),
          }, owner));

          return runId;
        }
      }

      const defaultSettings = plugin?.getDefaultSettings?.() ?? {};
      const mergedSettings = { ...defaultSettings, ...job.settings };

      if (isMaintenanceActive()) throw new Error("Cron execution refused: maintenance mode is active.");
      executionLock.assertOwned();
      // Execute the plugin
      if (!isManual && !authorized()) {
        await skipLostOwnership();
        return runId;
      }
      const lock = executionLock;
      await lock.whileOwned(owner => storage.jobRuns.interruptAbandonedCronRuns(job.name, run.id, owner));
      lock.assertOwned();
      if (!isManual && !authorized()) {
        await skipLostOwnership();
        return runId;
      }
      const summary = await Promise.race([executeCronPlugin(job.name, {
        configurationId: job.configurationId,
        jobId: job.name,
        jobName: job.name,
        triggeredBy,
        isManual,
        mode,
        settings: mergedSettings,
        execution: {
          assertOwned: () => lock.assertOwned(),
          inTransaction: work => lock.inTransaction(async () => {
            const current = await storage.jobRuns.getById(run.id);
            if (current?.status !== "running") throw new CronExecutionLost();
            return work();
          }),
        },
      }, () => lock.assertOwned()), lock.lost]);
      lock.assertOwned();

      // Calculate execution time
      const executionTimeMs = Date.now() - startedAt.getTime();

      // Prepare output with execution time and summary
      const outputData = {
        executionTimeMs,
        executionTimeSec: (executionTimeMs / 1000).toFixed(2),
        summary,
      };

      // Update run as successful
      await lock.whileOwned(owner => storage.jobRuns.update(run.id, {
        status: 'success',
        completedAt: new Date(),
        output: JSON.stringify(outputData),
      }, owner));
      lock.assertOwned();

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

      const failure = {
        status: error instanceof CronExecutionLost ? "interrupted" : 'error',
        completedAt: new Date(),
        error: errorMessage,
      };
      let interrupted = error instanceof CronExecutionLost;
      if (runId) {
        const id = runId;
        if (!interrupted && executionLock) {
          try {
            await executionLock.whileOwned(owner => storage.jobRuns.update(id, failure, owner));
          } catch { interrupted = true; }
        }
        if (interrupted) await storage.jobRuns.interruptIfRunning(id, new CronExecutionLost().message);
      }
      else {
        // Lock acquisition can fail before history exists.
        const run = await storage.jobRuns.create({ ...runDetails, ...failure });
        runId = run.id;
      }

      logger.error(`Job failed: ${job.name}`, {
        service: 'cron-scheduler',
        jobName: job.name,
        runId,
        error: errorMessage,
        duration: Date.now() - startedAt.getTime(),
      });

      if (isManual && interrupted) return runId;
      throw error;
    } finally {
      await executionLock?.close();
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
