import { logger } from "../../../logger";
import { isComponentEnabledSync } from "../../../services/component-cache";
import { storage } from "../../../storage";
import { applyComputed } from "./apply";
import { denormPluginRegistry } from "./registry";

/** Default cap on how many stale rows a single plugin drains per run. */
export const DEFAULT_RECOMPUTE_LIMIT = 1000;

/** Per-plugin outcome of a recompute sweep. */
export interface DenormRecomputePluginResult {
  pluginId: string;
  /** Rows recomputed and marked `ok` (`live`), or that would be (`test`). */
  recomputed: number;
  /** Rows that failed to recompute and were marked `error` (`live` only). */
  errored: number;
  /** Set when the plugin was skipped rather than processed. */
  skipped?: "component-disabled" | "no-config" | "config-disabled" | "error";
  /** Error message when `skipped === "error"`. */
  error?: string;
}

/** Aggregate outcome of `recomputeStaleDenorm`. */
export interface DenormRecomputeSummary {
  totalRecomputed: number;
  totalErrored: number;
  perPlugin: DenormRecomputePluginResult[];
}

export interface RecomputeAllOptions {
  /** Max stale rows per plugin per run. Defaults to {@link DEFAULT_RECOMPUTE_LIMIT}. */
  limit?: number;
  /**
   * `live` recomputes and persists; `test` (dry-run) only counts how many stale
   * rows it would recompute and writes nothing. Defaults to `live`.
   */
  mode?: "live" | "test";
}

/**
 * Recompute sweep across every registered denorm plugin — the queue-draining
 * half of the denorm lifecycle.
 *
 * For each eligible plugin (applying the same gating the backfill sweep uses:
 * required component on, config row present and enabled) it pulls up to `limit`
 * of the plugin's `stale` rows (oldest first) and, per row, recomputes the
 * payload via `compute` and routes it through the shared `applyComputed` helper,
 * which upserts the `denorm` status row to `ok` and writes the payload in one
 * transaction.
 *
 * A single bad entity is isolated: it is marked `error` (with the message) and
 * the sweep continues with the next row. Per-plugin failures are likewise
 * isolated so one plugin's error does not abort the whole sweep. Because each
 * plugin is capped at `limit` rows per run, a large backlog drains over several
 * hourly runs. In `test` mode nothing is written: it only counts the stale rows
 * it would recompute.
 */
export async function recomputeStaleDenorm(
  options: RecomputeAllOptions = {},
): Promise<DenormRecomputeSummary> {
  const limit = options.limit ?? DEFAULT_RECOMPUTE_LIMIT;
  const mode = options.mode ?? "live";
  const perPlugin: DenormRecomputePluginResult[] = [];
  let totalRecomputed = 0;
  let totalErrored = 0;

  for (const plugin of denormPluginRegistry.list()) {
    const pluginId = plugin.metadata.id;

    if (
      plugin.metadata.requiredComponent &&
      !isComponentEnabledSync(plugin.metadata.requiredComponent)
    ) {
      perPlugin.push({ pluginId, recomputed: 0, errored: 0, skipped: "component-disabled" });
      continue;
    }

    // Isolate per-plugin failures so one plugin's error doesn't abort the whole
    // sweep — the remaining plugins still get their chance this run.
    try {
      const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
      const config = configs[0];
      if (!config) {
        perPlugin.push({ pluginId, recomputed: 0, errored: 0, skipped: "no-config" });
        continue;
      }
      if (config.enabled === false) {
        perPlugin.push({ pluginId, recomputed: 0, errored: 0, skipped: "config-disabled" });
        continue;
      }

      const staleRows = await storage.denorm.getStaleBatchForConfig(config.id, limit);

      if (mode === "test") {
        totalRecomputed += staleRows.length;
        perPlugin.push({ pluginId, recomputed: staleRows.length, errored: 0 });
        continue;
      }

      let recomputed = 0;
      let errored = 0;
      for (const row of staleRows) {
        try {
          const payload = await plugin.compute(row.entityId);
          await applyComputed(plugin, config.id, row.entityId, payload);
          recomputed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errored++;
          logger.error(`Denorm recompute failed for plugin ${pluginId} entity ${row.entityId}`, {
            service: "denorm-recompute",
            pluginId,
            entityId: row.entityId,
            error: message,
          });
          // Mark the row `error` (failed apply rolled back, so it's still
          // `stale`) so the failure is visible and it isn't re-drained as stale.
          try {
            await storage.denorm.upsertStatus({
              entityId: row.entityId,
              entityType: plugin.entityType,
              configId: config.id,
              status: "error",
              message,
            });
          } catch (markError) {
            logger.error(
              `Failed to mark denorm row error for plugin ${pluginId} entity ${row.entityId}`,
              {
                service: "denorm-recompute",
                pluginId,
                entityId: row.entityId,
                error: markError instanceof Error ? markError.message : String(markError),
              },
            );
          }
        }
      }

      totalRecomputed += recomputed;
      totalErrored += errored;
      perPlugin.push({ pluginId, recomputed, errored });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Denorm recompute failed for plugin ${pluginId}`, {
        service: "denorm-recompute",
        pluginId,
        error: message,
      });
      perPlugin.push({ pluginId, recomputed: 0, errored: 0, skipped: "error", error: message });
    }
  }

  logger.info(
    `Denorm recompute ${mode === "live" ? "recomputed" : "would recompute"} ${totalRecomputed} stale rows (${totalErrored} errored)`,
    { service: "denorm-recompute", mode, totalRecomputed, totalErrored },
  );

  return { totalRecomputed, totalErrored, perPlugin };
}
