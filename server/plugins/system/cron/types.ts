import { z } from "zod";
import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import type { BasePluginMetadata } from "../../_core";

/**
 * Execution context handed to a cron plugin's `execute`. Carries the run
 * identity, who/what triggered it, and the merged settings (plugin defaults
 * overlaid with the operator-saved `data`). `mode` is "live" for real runs and
 * "test" for dry-runs that must not mutate persistent state.
 */
export interface CronJobContext {
  jobId: string;
  jobName: string;
  triggeredBy?: string;
  isManual: boolean;
  mode: "live" | "test";
  settings: Record<string, unknown>;
}

/**
 * Structured result from a cron plugin run. The scheduler wrapper logs based on
 * this — `message` is the human summary, `metadata` is optional structured
 * detail folded into the log entry.
 */
export interface CronJobResult {
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * A cron job, expressed as a plugin. Replaces the old `CronJobHandler` +
 * `DefaultCronJob` split: the schedule and enabled defaults that used to live
 * in `bootstrap.ts` now ride on the plugin alongside its execution logic and
 * settings contract.
 *
 * Cron plugins are singletons (`metadata.singleton === true`): exactly one
 * `plugin_configs` row exists per plugin, created by the boot-time singleton
 * seeder from `defaultSchedule` / `defaultEnabled`. The operator edits that
 * single row's schedule / enabled / settings via the generic plugin admin
 * page; they cannot add a second or delete it.
 */
export interface CronPlugin {
  /**
   * Base metadata. `id` is the cron job name (the stable identifier that keys
   * `cron_job_runs.jobName` and the `plugin_configs` row). `requiredComponent`
   * gates whether the job runs. `singleton` must be `true`.
   */
  metadata: BasePluginMetadata;
  /** Default cron expression, seeded into `plugin_configs_cron.schedule`. */
  defaultSchedule: string;
  /** Whether the job is enabled when first seeded. */
  defaultEnabled: boolean;
  /** Run the job. */
  execute(context: CronJobContext): Promise<CronJobResult>;
  /** Optional Zod schema validating the settings payload on save. */
  settingsSchema?: z.ZodSchema;
  /** Optional default settings, merged under the saved settings at run time. */
  getDefaultSettings?(): Record<string, unknown>;
  /**
   * JSON Schema describing the editable `data` fields the generic plugin admin
   * UI renders for this job's config row. Omit for jobs with no editable
   * settings (their Edit modal shows only schedule / enabled / name).
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;
}

/**
 * Manifest entry shape for cron plugins. Extends the base metadata with the
 * per-job settings form schema so the generic plugin admin Edit modal can
 * render each job's type-specific config (mirrors event-notifier).
 */
export interface CronManifestEntry extends BasePluginMetadata {
  configSchema?: JsonSchema;
  uiSchema?: UiSchema;
}
