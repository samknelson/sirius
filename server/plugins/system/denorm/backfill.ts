import { logger } from "../../../logger";
import { isPluginComponentEnabledSync } from "../../_core";
import { storage } from "../../../storage";
import { denormPluginRegistry } from "./registry";

/** Default cap on how many missing rows a single plugin enqueues per run. */
export const DEFAULT_BACKFILL_LIMIT = 5000;

/** Per-plugin outcome of a backfill sweep. */
export interface DenormBackfillPluginResult {
  pluginId: string;
  /** Rows enqueued (`live`) or that would be enqueued (`test`). */
  enqueued: number;
  /** Widow rows deleted (`live`) or that would be deleted (`test`). */
  deleted: number;
  /** Set when the plugin was skipped rather than processed. */
  skipped?: "no-backfill" | "component-disabled" | "no-config" | "config-disabled" | "error";
  /** Error message when `skipped === "error"`. */
  error?: string;
}

/** Aggregate outcome of `backfillAllDenorm`. */
export interface DenormBackfillSummary {
  totalEnqueued: number;
  totalDeleted: number;
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
  /**
   * When set, only the plugin with this id is processed; every other plugin is
   * skipped entirely (not even added to `perPlugin`). Omit to sweep all plugins.
   */
  pluginId?: string;
}

/**
 * Backfill sweep across every registered denorm plugin — the wrapper half of
 * the denorm backfill feature.
 *
 * For each eligible plugin it does up to two things, applying the same gating
 * the event handlers use (required component on, config row present and
 * enabled):
 *
 *   1. Enqueue: if the plugin implements `backfill`, ask it for the entity ids
 *      needing (re)compute — typically ids missing a denorm row, but a plugin
 *      may also return live invariant violators — and enqueue them as `stale`
 *      via `storage.denorm.insertStaleBatch` (idempotent upsert: existing rows
 *      are re-marked stale so violators with an old computed row re-enqueue).
 *   2. Widow cleanup: if the plugin implements `findWidows`, ask it for the
 *      entity ids whose denorm row has no surviving entity and delete those rows
 *      via `storage.denorm.deleteByEntityIdsForConfig` (dependent payload rows
 *      cascade away).
 *
 * Newly enqueued rows act as a queue for the (separate, later) `denorm_stale`
 * recompute job. Because each plugin is capped at `limit` rows per run, a large
 * backlog drains over several hourly runs rather than all at once. In `test`
 * mode nothing is written: both halves only count what they would do.
 */
export async function backfillAllDenorm(
  options: BackfillAllOptions = {},
): Promise<DenormBackfillSummary> {
  const limit = options.limit ?? DEFAULT_BACKFILL_LIMIT;
  const mode = options.mode ?? "live";
  const perPlugin: DenormBackfillPluginResult[] = [];
  let totalEnqueued = 0;
  let totalDeleted = 0;

  for (const plugin of denormPluginRegistry.list()) {
    const pluginId = plugin.metadata.id;

    if (options.pluginId && pluginId !== options.pluginId) {
      continue;
    }

    if (!plugin.backfill && !plugin.findWidows) {
      perPlugin.push({ pluginId, enqueued: 0, deleted: 0, skipped: "no-backfill" });
      continue;
    }

    if (!isPluginComponentEnabledSync(plugin.metadata)) {
      perPlugin.push({ pluginId, enqueued: 0, deleted: 0, skipped: "component-disabled" });
      continue;
    }

    // Isolate per-plugin failures so one plugin's error doesn't abort the whole
    // sweep — the remaining plugins still get their chance this run.
    try {
      const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
      if (!configs.length) {
        perPlugin.push({ pluginId, enqueued: 0, deleted: 0, skipped: "no-config" });
        continue;
      }
      const enabledConfigs = configs.filter(config => config.enabled !== false);
      if (!enabledConfigs.length) {
        perPlugin.push({ pluginId, enqueued: 0, deleted: 0, skipped: "config-disabled" });
        continue;
      }
      let enqueued = 0;
      let deleted = 0;
      const errors: string[] = [];
      for (const config of enabledConfigs) {
        try {
          if (plugin.backfill && enqueued < limit) {
            const staleIds = await plugin.backfill(config.id, limit - enqueued, config);
            if (staleIds.length > 0) {
              enqueued += mode === "live"
                ? await storage.denorm.insertStaleBatch(staleIds.map(entityId => ({
                    entityId, entityType: plugin.entityType, configId: config.id,
                  })))
                : staleIds.length;
            }
          }
          if (plugin.findWidows && deleted < limit) {
            const widowIds = await plugin.findWidows(config.id, limit - deleted, config);
            if (widowIds.length > 0) {
              deleted += mode === "live"
                ? await storage.denorm.deleteByEntityIdsForConfig(config.id, widowIds)
                : widowIds.length;
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${config.id}: ${message}`);
          logger.error("Denorm backfill failed for configuration", {
            service: "denorm-backfill", pluginId, configId: config.id, error: message,
          });
        }
      }
      totalEnqueued += enqueued;
      totalDeleted += deleted;
      perPlugin.push({ pluginId, enqueued, deleted,
        ...(errors.length ? { skipped: "error" as const, error: errors.join("; ") } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Denorm backfill failed for plugin ${pluginId}`, {
        service: "denorm-backfill",
        pluginId,
        error: message,
      });
      perPlugin.push({ pluginId, enqueued: 0, deleted: 0, skipped: "error", error: message });
    }
  }

  logger.info(
    `Denorm backfill ${mode === "live" ? "enqueued" : "would enqueue"} ${totalEnqueued} stale rows and ${mode === "live" ? "deleted" : "would delete"} ${totalDeleted} widow rows`,
    { service: "denorm-backfill", mode, totalEnqueued, totalDeleted },
  );

  return { totalEnqueued, totalDeleted, perPlugin };
}
