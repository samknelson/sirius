import { logger, storageLogger } from "../../../logger";
import { randomUUID } from "node:crypto";
import { isCacheInitialized } from "../../../services/component-cache";
import { eventBus, EventType } from "../../../services/event-bus";
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
    eventBus.on({
      name: "denorm-source-config-invalidation",
      description: "Invalidates source-owned derivations after their configuration changes.",
      event: EventType.PLUGIN_CONFIG_SAVED,
      handler: async ({ kind, id, operation }) => {
        if (kind !== "denorm" || operation !== "update" || !isCacheInitialized()) return;
        const config = await storage.pluginConfigs.get(id);
        const plugin = config && this.get(config.pluginId);
        if (plugin?.replaceOnCompute && isPluginComponentEnabledSync(plugin.metadata)) {
          await storage.denorm.clearForConfig(id);
        }
      },
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
          let claimed:
            | { entityId: string; configId: string; generation: number; claimToken: string }
            | undefined;
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
            if (!configs.length) {
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
            for (const config of configs) {
              claimed = undefined;
              try {
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
              continue;
            }
            if (eventHandler.deferred) {
              // The enqueue above is the whole event-path contract for an
              // expensive aggregate. It is intentionally not an in-memory
              // hand-off: the bounded drainer will read the durable row.
              continue;
            }
            const pending = await storage.denorm.claimStaleForEntity(
              { entityId, configId: config.id },
              randomUUID(),
            );
            if (!pending) continue;
            claimed = {
              entityId,
              configId: config.id,
              generation: pending.generation,
              claimToken: pending.claimToken,
            };
            const data = eventHandler.getPayload
              ? eventHandler.getPayload(payload, config)
              : await plugin.compute(entityId, config);
            await applyComputed(
              plugin,
              config.id,
              entityId,
              data,
              pending.generation,
              pending.claimToken,
            );
              } catch (error) {
                if (claimed) {
                  await storage.denorm.releaseClaimIfGeneration(claimed, claimed.generation, claimed.claimToken);
                  claimed = undefined;
                }
                logger.error("Denorm event failed for configuration", {
                  service: "denorm-registry", pluginId: plugin.metadata.id,
                  configId: config.id, entityId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          } catch (error) {
            // A thrown event-path compute/write must not retain its claim for
            // fifteen minutes. Return precisely this generation/token to
            // `stale` so the immediate sweep can heal a transient failure;
            // conditional release preserves a newer invalidation/claim.
            if (claimed) {
              try {
                await storage.denorm.releaseClaimIfGeneration(claimed, claimed.generation, claimed.claimToken);
              } catch (releaseError) {
                logger.error(
                  `Failed to release denorm claim after ${plugin.metadata.id} event failure`,
                  {
                    service: "denorm-registry",
                    pluginId: plugin.metadata.id,
                    entityId: claimed.entityId,
                    error: releaseError instanceof Error ? releaseError.message : String(releaseError),
                  },
                );
              }
            }
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

/**
 * Recompute one entity without pretending that a domain event occurred.
 *
 * Importers sometimes need to establish source rows without firing the normal
 * event because other listeners on that event have business effects (for
 * example, HOURS_SAVED can create charges). This still routes the write through
 * the owning plugin and the shared status-row transaction.
 */
export async function recomputeDenormEntity(
  pluginId: string,
  entityId: string,
): Promise<void> {
  const plugin = denormPluginRegistry.get(pluginId);
  if (!plugin) throw new Error(`Unknown denorm plugin: ${pluginId}`);
  if (!isPluginComponentEnabledSync(plugin.metadata)) return;
  const configs = await storage.pluginConfigs.getByKindAndPlugin(
    "denorm",
    pluginId,
  );
  if (!configs.length) throw new Error(`No denorm config found for plugin ${pluginId}`);
  for (const config of configs) {
    await storage.denorm.insertStaleBatch([
      { entityId, entityType: plugin.entityType, configId: config.id },
    ]);
    if (config.enabled === false) continue;
    const pending = await storage.denorm.claimStaleForEntity({ entityId, configId: config.id }, randomUUID());
    if (!pending) continue;
    try {
      await applyComputed(plugin, config.id, entityId, await plugin.compute(entityId, config),
        pending.generation, pending.claimToken);
    } catch (error) {
      await storage.denorm.releaseClaimIfGeneration({ entityId, configId: config.id },
        pending.generation, pending.claimToken);
      throw error;
    }
  }
}
