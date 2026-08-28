import { logger, storageLogger } from "../../../logger";
import { isCacheInitialized } from "../../../services/component-cache";
import { eventBus } from "../../../services/event-bus";
import { storage } from "../../../storage";
import { PluginRegistry, isPluginComponentEnabledSync } from "../../_core";
import { applyComputed } from "./apply";
import type { DenormPlugin, DenormManifestEntry } from "./types";

/**
 * Registry of denorm plugins. Reuses the generic `PluginRegistry` scaffolding
 * (component gating, access-policy gating, manifest shaping) like every other
 * plugin kind, and additionally subscribes each plugin's `eventHandlers` to the
 * event bus — mirroring the dispatch-eligibility registry. When a subscribed
 * event fires, the handler derives the affected entity id, builds the denorm
 * payload (from the event or via `compute`), and persists it through the shared
 * `applyComputed` helper, which marks the `denorm` status row `ok` and writes
 * the payload in one transaction.
 *
 * Metadata is nested under `.metadata`, matching the cron / charge / trust
 * eligibility convention.
 */
class DenormPluginRegistry extends PluginRegistry<DenormPlugin, DenormManifestEntry> {
  private subscribedHandlerIds = new Map<string, string[]>();

  constructor() {
    super({
      kind: "denorm",
      getMetadata: (p) => p.metadata,
      toManifestEntry: (p) => ({
        ...p.metadata,
        entityType: p.entityType,
        reads: p.reads,
        writes: p.writes,
        configSchema: p.configSchema,
        uiSchema: p.uiSchema,
      }),
      allowOverwrite: true,
    });
  }

  register(plugin: DenormPlugin): void {
    if (this.has(plugin.metadata.id)) {
      this.unsubscribePluginHandlers(plugin.metadata.id);
    }
    super.register(plugin);
    logger.info(`Denorm plugin registered: ${plugin.metadata.id}`, {
      service: "denorm-registry",
    });
    if (plugin.eventHandlers && plugin.eventHandlers.length > 0) {
      this.subscribePluginHandlers(plugin);
    }
  }

  private subscribePluginHandlers(plugin: DenormPlugin): void {
    if (!plugin.eventHandlers) return;
    const handlerIds: string[] = [];
    for (const eventHandler of plugin.eventHandlers) {
      const handlerId = eventBus.on({
        name: `denorm:${plugin.metadata.id}`,
        description:
          plugin.metadata.description ||
          `Updates ${plugin.metadata.id} denorm data for affected entities.`,
        event: eventHandler.event,
        handler: async (payload) => {
          if (!isCacheInitialized()) {
            logger.warn(
              `Component cache not initialized, skipping ${plugin.metadata.id} denorm update`,
              { service: "denorm-registry", pluginId: plugin.metadata.id },
            );
            return;
          }
          if (!isPluginComponentEnabledSync(plugin.metadata)) {
            logger.debug(
              `${plugin.metadata.requiredComponent} component not enabled, skipping denorm update`,
              { service: "denorm-registry", pluginId: plugin.metadata.id },
            );
            return;
          }
          try {
            const entityId = eventHandler.getEntityId(payload);
            if (!entityId || typeof entityId !== "string") {
              logger.error(
                `getEntityId returned invalid value for denorm plugin ${plugin.metadata.id}`,
                { service: "denorm-registry", pluginId: plugin.metadata.id, entityId },
              );
              return;
            }
            const configs = await storage.pluginConfigs.getByKindAndPlugin(
              "denorm",
              plugin.metadata.id,
            );
            const config = configs[0];
            if (!config) {
              logger.error(
                `No denorm config found for plugin ${plugin.metadata.id}; skipping update`,
                { service: "denorm-registry", pluginId: plugin.metadata.id },
              );
              storageLogger.error(
                `Denorm processing unavailable: no ${plugin.metadata.id} config exists, so event ${eventHandler.event} was dropped`,
                {
                  source: "denorm",
                  module: "denorm",
                  operation: "event_update_no_config",
                  description: `plugin ${plugin.metadata.id} has no plugin_configs row (seeding missing?)`,
                },
              );
              return;
            }
            // Durably enqueue before computing: if compute/apply below throws,
            // the row stays `stale` and the hourly denorm_stale cron recomputes
            // it instead of the update being silently lost forever. On success
            // applyComputed flips the row straight back to `ok`.
            await storage.denorm.insertStaleBatch([
              { entityId, entityType: plugin.entityType, configId: config.id },
            ]);
            if (!config.enabled) {
              // Disabled config = processing paused, not lost: leave the row
              // queued `stale` (the recompute sweep also skips disabled
              // configs) so it drains when the config is re-enabled.
              logger.info(
                `Denorm config ${plugin.metadata.id} is disabled; leaving entity ${entityId} queued stale`,
                { service: "denorm-registry", pluginId: plugin.metadata.id, entityId },
              );
              return;
            }
            const data = eventHandler.getPayload
              ? eventHandler.getPayload(payload)
              : await plugin.compute(entityId);
            await applyComputed(plugin, config.id, entityId, data);
          } catch (error) {
            // The entity's denorm row (marked `stale` above when the config
            // resolved) remains queued for the denorm_stale cron, and the
            // failure is surfaced in the admin log viewer.
            const message = error instanceof Error ? error.message : String(error);
            logger.error(
              `Denorm plugin ${plugin.metadata.id} failed to update from event ${eventHandler.event}`,
              {
                service: "denorm-registry",
                pluginId: plugin.metadata.id,
                event: eventHandler.event,
                error: message,
              },
            );
            storageLogger.error(
              `Denorm plugin ${plugin.metadata.id} failed to update from event ${eventHandler.event}; the record is queued stale for the next recompute sweep`,
              {
                source: "denorm",
                module: "denorm",
                operation: "event_update_failed",
                description: message,
              },
            );
          }
        },
      });
      handlerIds.push(handlerId);
    }
    this.subscribedHandlerIds.set(plugin.metadata.id, handlerIds);
  }

  private unsubscribePluginHandlers(pluginId: string): void {
    const handlerIds = this.subscribedHandlerIds.get(pluginId);
    if (handlerIds) {
      for (const handlerId of handlerIds) {
        eventBus.off(handlerId);
      }
      this.subscribedHandlerIds.delete(pluginId);
    }
  }
}

export const denormPluginRegistry = new DenormPluginRegistry();

/** Self-registration helper used by each plugin file under `./plugins/`. */
export function registerDenormPlugin(plugin: DenormPlugin): void {
  denormPluginRegistry.register(plugin);
}

export function getDenormPlugin(id: string): DenormPlugin | undefined {
  return denormPluginRegistry.get(id);
}
