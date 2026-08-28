import { storageLogger } from "../../../logger";
import { storage } from "../../../storage";
import type { DenormStaleSeed } from "../../../storage/system/denorm";
import { getDenormPlugin } from "./registry";

/**
 * Resolve the denorm stale seed for one (plugin, entity) pair — the durable
 * half of the "enqueue-then-recompute" denorm lifecycle. A producer whose
 * commit a denorm plugin derives from (e.g. the WMB scan queue recording a
 * scan result) resolves the seed BEFORE its commit and persists the `stale`
 * mark in the SAME transaction, so derived-data processing can never be lost:
 * the completion-event handler recomputes immediately and flips the row back
 * to `ok`; if that handler is missing, skipped, or fails, the row stays
 * `stale`, is visible in the operator denorm dashboard (`/api/denorm/configs`),
 * and the hourly `denorm_stale` cron recomputes it.
 *
 * Returns `null` — with an operator alert in the admin log viewer — when no
 * config row exists, because then neither the event handler nor the stale
 * cron can ever process the entity: the safety net is not armed.
 */
export async function getDenormStaleSeed(
  pluginId: string,
  entityId: string,
  fallbackEntityType = "worker",
): Promise<DenormStaleSeed | null> {
  const plugin = getDenormPlugin(pluginId);
  const entityType = plugin?.entityType ?? fallbackEntityType;
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", pluginId);
  const config = configs[0];
  if (!config) {
    storageLogger.error(
      `Denorm processing unavailable: no ${pluginId} config exists, so derived data for entity ${entityId} will not be computed`,
      {
        source: "denorm",
        module: "denorm",
        operation: "mark_stale_no_config",
        entity_id: entityId,
        description: `plugin ${pluginId} has no plugin_configs row (seeding missing?)`,
      },
    );
    return null;
  }
  if (!config.enabled) {
    // The row will still be queued stale, but a disabled config is skipped by
    // both the event handler path and the stale-recompute cron — make that
    // visible so operators know processing is paused, not lost.
    storageLogger.warn(
      `Denorm config ${pluginId} is disabled; entity ${entityId} is queued stale and will not recompute until it is re-enabled`,
      {
        source: "denorm",
        module: "denorm",
        operation: "mark_stale_config_disabled",
        entity_id: entityId,
        description: `plugin ${pluginId} config ${config.id} disabled`,
      },
    );
  }
  return { entityId, entityType, configId: config.id };
}
