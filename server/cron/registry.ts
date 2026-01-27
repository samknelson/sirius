import { logger } from "../logger";
import { z } from "zod";

export interface CronJobContext {
  jobId: string;
  jobName: string;
  triggeredBy?: string;
  isManual: boolean;
  mode: "live" | "test"; // "live" for production runs, "test" for dry-run (no DB changes)
  settings: Record<string, unknown>; // Job-specific settings
}

/**
 * Structured result from a cron job execution.
 * The wrapper handles all logging based on this return value.
 */
export interface CronJobResult {
  /** Human-readable summary message (e.g., "Deleted 6 expired entries") */
  message: string;
  /** Optional structured metadata for the log entry (e.g., { scanned: 200, deleted: 6 }) */
  metadata?: Record<string, unknown>;
}

/** @deprecated Use CronJobResult instead */
export interface CronJobSummary {
  [key: string]: any; // Flexible summary data specific to each job
}

export interface CronJobSettingsField {
  key: string;
  label: string;
  type: "number" | "string" | "boolean";
  description?: string;
  min?: number; // For number type
  max?: number; // For number type
}

/**
 * Settings adapter for cron jobs with custom settings UI.
 * Jobs can either use the simple 'fields' mode (using getSettingsFields)
 * or a 'custom' mode with a registered frontend component.
 */
export interface CronJobSettingsAdapter {
  /** The frontend component ID to render for custom settings */
  componentId: string;
  
  /** 
   * Load client state for the settings UI.
   * Returns data needed to render the custom settings component
   * (e.g., stats, options, current values merged with defaults).
   */
  loadClientState: (currentSettings: Record<string, unknown>) => Promise<{
    clientState: Record<string, unknown>;
    values: Record<string, unknown>;
  }>;
  
  /**
   * Validate and transform submitted settings data.
   * Returns the normalized settings object to persist.
   */
  applyUpdate: (data: unknown) => Promise<Record<string, unknown>>;
}

export interface CronJobHandler {
  execute: (context: CronJobContext) => Promise<CronJobResult>;
  description?: string;
  requiresComponent?: string; // Component ID that must be enabled for this job to run
  settingsSchema?: z.ZodSchema; // Zod schema for validating settings
  getDefaultSettings?: () => Record<string, unknown>; // Default settings values
  getSettingsFields?: () => CronJobSettingsField[]; // UI field definitions (for 'fields' mode)
  settingsAdapter?: CronJobSettingsAdapter; // Custom settings adapter (for 'custom' mode)
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

  async execute(name: string, context: CronJobContext): Promise<CronJobResult> {
    const handler = this.jobs.get(name);
    if (!handler) {
      throw new Error(`Cron job "${name}" is not registered`);
    }

    const modePrefix = context.mode === 'test' ? '[TEST] ' : '';
    const serviceName = `cron-${name}`;

    try {
      const result = await handler.execute(context);
      
      logger.info(`${modePrefix}${result.message}`, {
        service: serviceName,
        jobId: context.jobId,
        mode: context.mode,
        isManual: context.isManual,
        ...(result.metadata || {}),
      });
      
      return result;
    } catch (error) {
      logger.error(`${modePrefix}Job failed: ${error instanceof Error ? error.message : String(error)}`, {
        service: serviceName,
        jobId: context.jobId,
        mode: context.mode,
        isManual: context.isManual,
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
