import * as cron from 'node-cron';
import { db } from "../db";
import { cronJobs, cronJobRuns, type CronJob } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import { cronJobRegistry } from "./registry";

interface ScheduledJob {
  cronJob: CronJob;
  task: cron.ScheduledTask;
}

class CronScheduler {
  private scheduledJobs: Map<string, ScheduledJob> = new Map();
  private isRunning: boolean = false;

  async start(): Promise<void> {
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
    const jobs = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.isEnabled, true));

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

  private async scheduleJob(cronJob: CronJob): Promise<void> {
    // Check if handler exists in registry
    if (!cronJobRegistry.has(cronJob.name)) {
      logger.warn(`No handler registered for job: ${cronJob.name}`, {
        service: 'cron-scheduler',
        jobName: cronJob.name,
      });
      return;
    }

    // Validate cron expression
    if (!cron.validate(cronJob.schedule)) {
      logger.error(`Invalid cron expression for job: ${cronJob.name}`, {
        service: 'cron-scheduler',
        jobName: cronJob.name,
        schedule: cronJob.schedule,
      });
      return;
    }

    // Create scheduled task
    const task = cron.schedule(
      cronJob.schedule,
      async () => {
        await this.executeJob(cronJob, false);
      }
    );

    this.scheduledJobs.set(cronJob.name, { cronJob, task });

    logger.info(`Scheduled job: ${cronJob.name}`, {
      service: 'cron-scheduler',
      jobName: cronJob.name,
      schedule: cronJob.schedule,
    });
  }

  async executeJob(cronJob: CronJob, isManual: boolean, triggeredBy?: string, mode: "live" | "test" = "live"): Promise<void> {
    const runId = crypto.randomUUID();
    const startedAt = new Date();

    logger.info(`Starting job execution: ${cronJob.name}`, {
      service: 'cron-scheduler',
      jobName: cronJob.name,
      runId,
      isManual,
      triggeredBy,
      mode,
    });

    // Create run record
    const [run] = await db
      .insert(cronJobRuns)
      .values({
        id: runId,
        jobName: cronJob.name,
        status: 'running',
        mode,
        startedAt,
        triggeredBy: triggeredBy || null,
      })
      .returning();

    try {
      // Execute the job handler
      const summary = await cronJobRegistry.execute(cronJob.name, {
        jobId: cronJob.name,
        jobName: cronJob.name,
        triggeredBy,
        isManual,
        mode,
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
      await db
        .update(cronJobRuns)
        .set({
          status: 'success',
          completedAt: new Date(),
          output: JSON.stringify(outputData),
        })
        .where(eq(cronJobRuns.id, runId));

      logger.info(`Job completed successfully: ${cronJob.name}`, {
        service: 'cron-scheduler',
        jobName: cronJob.name,
        runId,
        duration: executionTimeMs,
        summary,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Update run as failed
      await db
        .update(cronJobRuns)
        .set({
          status: 'error',
          completedAt: new Date(),
          error: errorMessage,
        })
        .where(eq(cronJobRuns.id, runId));

      logger.error(`Job failed: ${cronJob.name}`, {
        service: 'cron-scheduler',
        jobName: cronJob.name,
        runId,
        error: errorMessage,
        duration: Date.now() - startedAt.getTime(),
      });

      throw error;
    }
  }

  async manualRun(jobName: string, triggeredBy?: string, mode: "live" | "test" = "live"): Promise<void> {
    const [job] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.name, jobName));

    if (!job) {
      logger.error('Attempted to run non-existent cron job', {
        service: 'cron-scheduler',
        jobName,
      });
      throw new Error(`Cron job not found: ${jobName}`);
    }

    if (!cronJobRegistry.has(job.name)) {
      logger.error('Attempted to run cron job with no registered handler', {
        service: 'cron-scheduler',
        jobName: job.name,
        availableHandlers: cronJobRegistry.getAllNames(),
      });
      throw new Error(
        `No handler registered for job "${job.name}". ` +
        `Available handlers: ${cronJobRegistry.getAllNames().join(', ') || 'none'}`
      );
    }

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
