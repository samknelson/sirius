import { logger } from "../../../logger";
import { isComponentEnabledSync } from "../../../services/component-cache";
import { storage } from "../../../storage";
import { denormPluginRegistry } from "./registry";

/** Default cap on how many missing rows a single plugin enqueues per run. */
export const DEFAULT_BACKFILL_LIMIT = 5000;

/** Per-plugin outcome of a backfill sweep. */
export interface DenormBackfillPluginResult {
  pluginId: string;
  /** Rows enqueued (`live`) or that would be enqueued (`test`). */
  enqueued: number;
  /** Set when the plugin was skipped rather than processed. */
  skipped?: "no-backfill" | "component-disabled" | "no-config" | "config-disabled" | "error";
  /** Error message when `skipped === "error"`. */
  error?: string;
}

/** Aggregate outcome of `backfillAllDenorm`. */
export interface DenormBackfillSummary {
  totalEnqueued: number;
  perPlugin: DenormBackfillPluginResult[];
}

export interface BackfillAllOptions {
  /** Max rows per plugin per run. Defaults to {@link DEFAULT_BACKFILL_LIMIT}. */
  limit?: number;
  /**
   * `live` inserts the stale rows; `test` (dry-run) only counts what it would
   * enqueue and writes nothing. Defaults to `live`.
   */
  mode?: "live" | "test";
}

/**
 * Backfill sweep across every registered denorm plugin — the wrapper half of
 * the denorm backfill feature.
 *
 * For each plugin that implements `backfill`, this applies the same gating the
 * event handlers use (required component on, config row present and enabled),
 * asks the plugin for the entity ids missing a denorm row, and enqueues them as
 * `stale` via `storage.denorm.insertStaleBatch` (which skips rows that already
 * exist, so the sweep is idempotent and never clobbers an existing row).
 *
 * Newly enqueued rows act as a queue for the (separate, later) `denorm_stale`
 * recompute job. Because each plugin is capped at `limit` rows per run, a large
 * backlog drains over several hourly runs rather than all at once.
 */
export async function backfillAllDenorm(
  options: BackfillAllOptions = {},
): Promise<DenormBackfillSummary> {
  const limit = options.limit ?? DEFAULT_BACKFILL_LIMIT;
  const mode = options.mode ?? "live";
  const perPlugin: DenormBackfillPluginResult[] = [];
  let totalEnqueued = 0;

  for (const plugin of denormPluginRegistry.list()) {
    const pluginId = plugin.metadata.id;

    if (!plugin.backfill) {
      perPlugin.push({ pluginId, enqueued: 0, skipped: "no-backfill" });
      continue;
    }

    if (
      plugin.metadata.requiredComponent &&
      !isComponentEnabledSync(plugin.metadata.requiredComponent)
    ) {
      perPlugin.push({ pluginId, enqueued: 0, skipped: "component-disabled" });
      continue;
    }

    // Isolate per-plugin failures so one plugin's error doesn't abort the whole
    // sweep — the remaining plugins still get their chance this run.
    try {
      const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
      const config = configs[0];
      if (!config) {
        perPlugin.push({ pluginId, enqueued: 0, skipped: "no-config" });
        continue;
      }
      if (config.enabled === false) {
        perPlugin.push({ pluginId, enqueued: 0, skipped: "config-disabled" });
        continue;
      }

      const missingIds = await plugin.backfill(config.id, limit);
      let enqueued = 0;
      if (missingIds.length > 0) {
        if (mode === "live") {
          enqueued = await storage.denorm.insertStaleBatch(
            missingIds.map((entityId) => ({
              entityId,
              entityType: plugin.entityType,
              configId: config.id,
            })),
          );
        } else {
          enqueued = missingIds.length;
        }
      }

      totalEnqueued += enqueued;
      perPlugin.push({ pluginId, enqueued });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Denorm backfill failed for plugin ${pluginId}`, {
        service: "denorm-backfill",
        pluginId,
        error: message,
      });
      perPlugin.push({ pluginId, enqueued: 0, skipped: "error", error: message });
    }
  }

  logger.info(
    `Denorm backfill ${mode === "live" ? "enqueued" : "would enqueue"} ${totalEnqueued} stale rows`,
    { service: "denorm-backfill", mode, totalEnqueued },
  );

  return { totalEnqueued, perPlugin };
}
