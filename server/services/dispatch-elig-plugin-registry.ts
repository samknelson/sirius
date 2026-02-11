import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";
import { eventBus, EventType } from "./event-bus";
import type { EligibilityPluginMetadata, EligibilityPluginConfig, PluginConfigField } from "@shared/schema";

/**
 * Represents a condition that a plugin contributes to the eligible workers query.
 * Each condition specifies how to check the worker_dispatch_elig_denorm table.
 */
export interface EligibilityCondition {
  /** The category to check in the denorm table */
  category: string;
  /** 
   * The type of check to perform:
   * - "exists": Worker must have a row with this category and value
   * - "not_exists": Worker must NOT have a row with this category and value
   * - "exists_or_none": Worker must either have no rows with this category, OR have one matching the value
   * - "not_exists_category": Worker must NOT have ANY row with this category (value is ignored in query but used for documentation)
   * - "exists_all": Worker must have rows with this category for ALL values in the array
   * - "not_exists_unless_exists": Worker must NOT have a row with this category+value, UNLESS they have a row with unlessCategory+unlessValue.
   *   This allows a blocking condition to be overridden by a separate "exemption" entry.
   *   Example: singleshift blocks workers with an accepted dispatch on the same date, but exempts the worker if they already accepted THIS specific job.
   */
  type: "exists" | "not_exists" | "exists_or_none" | "not_exists_category" | "exists_all" | "not_exists_unless_exists";
  /** The value to check. Can be a static value or derived from job context. For not_exists_category, this is informational only. For exists_all, this is a comma-separated list of values. */
  value: string;
  /** For exists_all: array of values that must all exist. */
  values?: string[];
  /** For not_exists_unless_exists: the category that provides the exemption override */
  unlessCategory?: string;
  /** For not_exists_unless_exists: the value in the unless category that grants exemption */
  unlessValue?: string;
}

/**
 * Context provided to plugins when building eligibility conditions.
 * Contains information about the job being queried.
 */
export interface EligibilityQueryContext {
  jobId: string;
  employerId: string;
  jobTypeId: string | null;
}

/**
 * Base interface for event payloads that can trigger eligibility recomputation.
 * All eligible event types must include a workerId field.
 */
export interface WorkerEventPayload {
  workerId: string;
}

/**
 * Describes an event handler that a plugin wants to subscribe to.
 * The handler will be called when the specified event is emitted.
 * 
 * IMPORTANT: Only subscribe to events whose payloads include a `workerId` field.
 * The registry validates this at runtime and will log errors for invalid payloads.
 * 
 * Supported events:
 * - DISPATCH_DNC_SAVED
 * - DISPATCH_HFE_SAVED
 * - DISPATCH_STATUS_SAVED
 * - WORKER_BAN_SAVED
 */
export interface PluginEventHandler {
  /** The event type to listen for. Must be an event with a workerId in its payload. */
  event: EventType;
  /** 
   * Handler function that receives the event payload and returns the worker ID to recompute.
   * The payload is guaranteed to have a workerId field at runtime.
   */
  getWorkerId: (payload: WorkerEventPayload) => string;
}

export interface DispatchEligPlugin {
  id: string;
  name: string;
  description: string;
  componentId: string;
  /** Optional event handlers this plugin wants to subscribe to */
  eventHandlers?: PluginEventHandler[];
  /** Optional configuration fields that can be set per job type */
  configFields?: PluginConfigField[];
  recomputeWorker(workerId: string): Promise<void>;
  /**
   * Returns the eligibility condition this plugin contributes to the query.
   * Called when building the eligible workers query for a job.
   * @param context - Information about the job being queried
   * @param config - Per-plugin configuration from the job type
   * @returns The condition to add to the query, or null if no condition needed
   */
  getEligibilityCondition(context: EligibilityQueryContext, config: EligibilityPluginConfig["config"]): EligibilityCondition | null | Promise<EligibilityCondition | null>;
}

class DispatchEligPluginRegistry {
  private plugins = new Map<string, DispatchEligPlugin>();
  private subscribedHandlerIds = new Map<string, string[]>();

  register(plugin: DispatchEligPlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Dispatch eligibility plugin ${plugin.id} already registered, overwriting`, {
        service: "dispatch-elig-registry",
      });
      this.unsubscribePluginHandlers(plugin.id);
    }
    this.plugins.set(plugin.id, plugin);
    logger.info(`Dispatch eligibility plugin registered: ${plugin.id}`, {
      service: "dispatch-elig-registry",
    });

    if (plugin.eventHandlers && plugin.eventHandlers.length > 0) {
      this.subscribePluginHandlers(plugin);
    }
  }

  private subscribePluginHandlers(plugin: DispatchEligPlugin): void {
    if (!plugin.eventHandlers) return;

    const handlerIds: string[] = [];

    for (const eventHandler of plugin.eventHandlers) {
      const handlerId = eventBus.on(eventHandler.event, async (payload) => {
        if (!isCacheInitialized()) {
          logger.warn(`Component cache not initialized, skipping ${plugin.id} eligibility recompute`, {
            service: "dispatch-elig-registry",
            pluginId: plugin.id,
          });
          return;
        }

        if (!isComponentEnabledSync(plugin.componentId)) {
          logger.debug(`${plugin.componentId} component not enabled, skipping recompute`, {
            service: "dispatch-elig-registry",
            pluginId: plugin.id,
          });
          return;
        }

        // Runtime validation: ensure payload contains workerId
        if (!payload || typeof payload !== "object" || !("workerId" in payload)) {
          logger.error(`Event payload missing workerId for plugin ${plugin.id}`, {
            service: "dispatch-elig-registry",
            pluginId: plugin.id,
            event: eventHandler.event,
          });
          return;
        }

        try {
          const workerId = eventHandler.getWorkerId(payload as WorkerEventPayload);
          if (!workerId || typeof workerId !== "string") {
            logger.error(`getWorkerId returned invalid value for plugin ${plugin.id}`, {
              service: "dispatch-elig-registry",
              pluginId: plugin.id,
              workerId,
            });
            return;
          }
          await plugin.recomputeWorker(workerId);
        } catch (error) {
          logger.error(`Failed to extract workerId for plugin ${plugin.id}`, {
            service: "dispatch-elig-registry",
            pluginId: plugin.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      handlerIds.push(handlerId);
    }

    this.subscribedHandlerIds.set(plugin.id, handlerIds);
    logger.debug(`Subscribed ${handlerIds.length} event handler(s) for plugin ${plugin.id}`, {
      service: "dispatch-elig-registry",
      pluginId: plugin.id,
      handlerCount: handlerIds.length,
    });
  }

  private unsubscribePluginHandlers(pluginId: string): void {
    const handlerIds = this.subscribedHandlerIds.get(pluginId);
    if (handlerIds) {
      for (const handlerId of handlerIds) {
        eventBus.off(handlerId);
      }
      this.subscribedHandlerIds.delete(pluginId);
      logger.debug(`Unsubscribed ${handlerIds.length} event handler(s) for plugin ${pluginId}`, {
        service: "dispatch-elig-registry",
        pluginId,
      });
    }
  }

  unregister(pluginId: string): boolean {
    this.unsubscribePluginHandlers(pluginId);
    const removed = this.plugins.delete(pluginId);
    if (removed) {
      logger.info(`Dispatch eligibility plugin unregistered: ${pluginId}`, {
        service: "dispatch-elig-registry",
      });
    }
    return removed;
  }

  getPlugin(pluginId: string): DispatchEligPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getEnabledPlugins(): DispatchEligPlugin[] {
    const enabledPlugins: DispatchEligPlugin[] = [];
    const allPlugins = Array.from(this.plugins.values());
    for (const plugin of allPlugins) {
      const enabled = isComponentEnabledSync(plugin.componentId);
      if (enabled) {
        enabledPlugins.push(plugin);
      }
    }
    return enabledPlugins;
  }

  async recomputeWorkerForAllPlugins(workerId: string): Promise<void> {
    const enabledPlugins = this.getEnabledPlugins();
    for (const plugin of enabledPlugins) {
      try {
        await plugin.recomputeWorker(workerId);
      } catch (error) {
        logger.error(`Dispatch eligibility plugin ${plugin.id} failed to recompute worker ${workerId}`, {
          service: "dispatch-elig-registry",
          pluginId: plugin.id,
          workerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  getAllPluginIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  getAllPluginsMetadata(): EligibilityPluginMetadata[] {
    return Array.from(this.plugins.values()).map(plugin => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      componentId: plugin.componentId,
      componentEnabled: isComponentEnabledSync(plugin.componentId),
      configFields: plugin.configFields,
    }));
  }
}

export const dispatchEligPluginRegistry = new DispatchEligPluginRegistry();
