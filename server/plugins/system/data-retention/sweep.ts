import { logger } from "../../../logger";
import { isPluginComponentEnabledSync } from "../../_core";
import { storage } from "../../../storage";
import { dataRetentionPluginRegistry } from "./registry";
import type { DataRetentionMode } from "./types";

/** Per-plugin outcome of a retention sweep. */
export interface DataRetentionPluginResult {
  pluginId: string;
  /** Rows deleted (`live`) or that would be deleted (`test`). */
  count: number;
  /** Human summary from the plugin's cleanup. */
  message?: string;
  /** Set when the plugin was skipped rather than processed. */
  skipped?: "component-disabled" | "no-config" | "config-disabled" | "error";
  /** Error message when `skipped === "error"`. */
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Aggregate outcome of `runDataRetention`. */
export interface DataRetentionSummary {
  totalDeleted: number;
  totalErrored: number;
  perPlugin: DataRetentionPluginResult[];
}

export interface RunDataRetentionOptions {
  /** `live` deletes; `test` (dry-run) only counts. Defaults to `live`. */
  mode?: DataRetentionMode;
  /** When set, only the plugin with this id is processed. */
  pluginId?: string;
}

/**
 * Retention sweep across every registered data-retention plugin — invoked by
 * the single `data-retention` cron job.
 *
 * For each eligible plugin (required component on, config row present and
 * enabled) it calls `cleanup(mode)`. Per-plugin failures are isolated so one
 * failing plugin does not abort the sweep — the remaining plugins still run.
 */
export async function runDataRetention(
  options: RunDataRetentionOptions = {},
): Promise<DataRetentionSummary> {
  const mode = options.mode ?? "live";
  const perPlugin: DataRetentionPluginResult[] = [];
  let totalDeleted = 0;
  let totalErrored = 0;

  for (const plugin of dataRetentionPluginRegistry.list()) {
    const pluginId = plugin.metadata.id;

    if (options.pluginId && pluginId !== options.pluginId) {
      continue;
    }

    if (!isPluginComponentEnabledSync(plugin.metadata)) {
      perPlugin.push({ pluginId, count: 0, skipped: "component-disabled" });
      continue;
    }

    try {
      const configs = await storage.pluginConfigs.getByKindAndPlugin(
        "data-retention",
        pluginId,
      );
      const config = configs[0];
      if (!config) {
        perPlugin.push({ pluginId, count: 0, skipped: "no-config" });
        continue;
      }
      if (config.enabled === false) {
        perPlugin.push({ pluginId, count: 0, skipped: "config-disabled" });
        continue;
      }

      const result = await plugin.cleanup(mode);
      totalDeleted += result.count;
      perPlugin.push({
        pluginId,
        count: result.count,
        message: result.message,
        metadata: result.metadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      totalErrored++;
      perPlugin.push({ pluginId, count: 0, skipped: "error", error: message });
      logger.error(`Data-retention plugin ${pluginId} failed`, {
        service: "data-retention-sweep",
        pluginId,
        mode,
        error: message,
      });
    }
  }

  return { totalDeleted, totalErrored, perPlugin };
}
