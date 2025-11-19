import { logger } from "../logger";

export interface CronJobContext {
  jobId: string;
  jobName: string;
  triggeredBy?: string;
  isManual: boolean;
  mode: "live" | "test"; // "live" for production runs, "test" for dry-run (no DB changes)
}

export interface CronJobHandler {
  execute: (context: CronJobContext) => Promise<void>;
  description?: string;
}

export interface RegisteredCronJob {
  name: string;
  handler: CronJobHandler;
  description?: string;
}

class CronJobRegistry {
  private jobs: Map<string, CronJobHandler> = new Map();

  register(name: string, handler: CronJobHandler): void {
    if (this.jobs.has(name)) {
      throw new Error(`Cron job "${name}" is already registered`);
    }
    this.jobs.set(name, handler);
    logger.info(`Registered cron job: ${name}`, { service: 'cron-registry' });
  }

  get(name: string): CronJobHandler | undefined {
    return this.jobs.get(name);
  }

  getAll(): RegisteredCronJob[] {
    return Array.from(this.jobs.entries()).map(([name, handler]) => ({
      name,
      handler,
      description: handler.description,
    }));
  }

  getAllNames(): string[] {
    return Array.from(this.jobs.keys());
  }

  has(name: string): boolean {
    return this.jobs.has(name);
  }

  async execute(name: string, context: CronJobContext): Promise<void> {
    const handler = this.jobs.get(name);
    if (!handler) {
      throw new Error(`Cron job "${name}" is not registered`);
    }

    logger.info(`Executing cron job: ${name}`, {
      service: 'cron-registry',
      jobId: context.jobId,
      isManual: context.isManual,
      triggeredBy: context.triggeredBy,
    });

    try {
      await handler.execute(context);
      logger.info(`Cron job completed successfully: ${name}`, {
        service: 'cron-registry',
        jobId: context.jobId,
      });
    } catch (error) {
      logger.error(`Cron job failed: ${name}`, {
        service: 'cron-registry',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const cronJobRegistry = new CronJobRegistry();

export function registerCronJob(name: string, handler: CronJobHandler): void {
  cronJobRegistry.register(name, handler);
}

export function getCronJobHandler(name: string): CronJobHandler | undefined {
  return cronJobRegistry.get(name);
}

export function getAllCronJobs(): RegisteredCronJob[] {
  return cronJobRegistry.getAll();
}
