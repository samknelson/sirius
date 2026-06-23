import { logger } from "../../../logger";
import { PluginRegistry } from "../../_core";
import type { BasePluginMetadata } from "../../_core";
import type { CronPlugin, CronJobContext, CronJobResult } from "./types";

/**
 * Registry of cron plugins. Reuses the generic `PluginRegistry` scaffolding
 * (component gating, access-policy gating, manifest shaping) so cron jobs are
 * first-class plugins like every other kind. Metadata is nested under
 * `.metadata`, matching the charge / trust-eligibility convention.
 */
export const cronPluginRegistry = new PluginRegistry<CronPlugin, BasePluginMetadata>({
  kind: "cron",
  getMetadata: (p) => p.metadata,
  toManifestEntry: (p) => p.metadata,
});

/** Self-registration helper used by each plugin file under `./plugins/`. */
export function registerCronPlugin(plugin: CronPlugin): void {
  cronPluginRegistry.register(plugin);
  logger.info(`Registered cron plugin: ${plugin.metadata.id}`, {
    service: "cron-registry",
  });
}

export function getCronPlugin(id: string): CronPlugin | undefined {
  return cronPluginRegistry.get(id);
}

/**
 * Execute a registered cron plugin and emit the standard success/failure log
 * lines (service `cron-<id>`), preserving the logging contract the legacy
 * `CronJobRegistry.execute` provided. The scheduler owns run-record bookkeeping
 * (`cron_job_runs`); this helper only runs the plugin and logs its result.
 */
export async function executeCronPlugin(
  id: string,
  context: CronJobContext,
): Promise<CronJobResult> {
  const plugin = cronPluginRegistry.get(id);
  if (!plugin) {
    throw new Error(`Cron plugin "${id}" is not registered`);
  }

  const modePrefix = context.mode === "test" ? "[TEST] " : "";
  const serviceName = `cron-${id}`;

  try {
    const result = await plugin.execute(context);
    logger.info(`${modePrefix}${result.message}`, {
      service: serviceName,
      jobId: context.jobId,
      mode: context.mode,
      isManual: context.isManual,
      ...(result.metadata || {}),
    });
    return result;
  } catch (error) {
    logger.error(
      `${modePrefix}Job failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        service: serviceName,
        jobId: context.jobId,
        mode: context.mode,
        isManual: context.isManual,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    throw error;
  }
}
