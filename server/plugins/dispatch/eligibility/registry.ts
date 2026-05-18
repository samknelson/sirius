import { logger } from "../../../logger";
import { isComponentEnabledSync, isCacheInitialized } from "../../../services/component-cache";
import { eventBus, EventType } from "../../../services/event-bus";
import { PluginRegistry } from "../../_core";
import type { BasePluginMetadata } from "../../_core";
import type { EligibilityPluginMetadata, EligibilityPluginConfig } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";

/**
 * Represents a condition that a plugin contributes to the eligible workers query.
 * Each condition specifies how to check the worker_dispatch_elig_denorm table.
 */
export interface EligibilityCondition {
  category: string;
  type: "exists" | "not_exists" | "exists_or_none" | "not_exists_category" | "exists_all" | "not_exists_unless_exists";
  value: string;
  values?: string[];
  unlessCategory?: string;
  unlessValue?: string;
}

export interface EligibilityQueryContext {
  jobId: string;
  employerId: string;
  jobTypeId: string | null;
}

export interface WorkerEventPayload {
  workerId: string;
}

export interface PluginEventHandler {
  event: EventType;
  getWorkerId: (payload: WorkerEventPayload) => string;
}

export interface DispatchEligPlugin {
  id: string;
  name: string;
  description: string;
  /** Canonical component-gate field (renamed from `componentId` in Task #208). */
  requiredComponent?: string;
  /** Hide from the job-type-config UI (infrastructure plugins). */
  hidden?: boolean;
  eventHandlers?: PluginEventHandler[];
  configSchema?: JsonSchema;
  recomputeWorker(workerId: string): Promise<void>;
  getEligibilityCondition(
    context: EligibilityQueryContext,
    config: EligibilityPluginConfig["config"],
  ): EligibilityCondition | EligibilityCondition[] | null | Promise<EligibilityCondition | EligibilityCondition[] | null>;
  backfill?(): Promise<{ workersProcessed: number; entriesCreated: number }>;
  backfillOrder?: number;
}

function pluginToMetadata(p: DispatchEligPlugin): BasePluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    hidden: p.hidden,
  };
}

function pluginToManifestEntry(p: DispatchEligPlugin): EligibilityPluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    componentId: p.requiredComponent ?? "",
    componentEnabled: !p.requiredComponent || isComponentEnabledSync(p.requiredComponent),
    configSchema: p.configSchema,
  };
}

class DispatchEligPluginRegistry extends PluginRegistry<DispatchEligPlugin, EligibilityPluginMetadata> {
  private subscribedHandlerIds = new Map<string, string[]>();

  constructor() {
    super({
      kind: "dispatch-eligibility",
      getMetadata: pluginToMetadata,
      toManifestEntry: pluginToManifestEntry,
      allowOverwrite: true,
    });
  }

  register(plugin: DispatchEligPlugin): void {
    if (this.has(plugin.id)) {
      this.unsubscribePluginHandlers(plugin.id);
    }
    super.register(plugin);
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
        if (plugin.requiredComponent && !isComponentEnabledSync(plugin.requiredComponent)) {
          logger.debug(`${plugin.requiredComponent} component not enabled, skipping recompute`, {
            service: "dispatch-elig-registry",
            pluginId: plugin.id,
          });
          return;
        }
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

  // Backwards-compatible aliases for legacy call sites.
  getPlugin(pluginId: string): DispatchEligPlugin | undefined {
    return this.get(pluginId);
  }

  getEnabledPlugins(): DispatchEligPlugin[] {
    return this.listEnabledSync();
  }

  getAllPlugins(): DispatchEligPlugin[] {
    return this.list();
  }

  getAllPluginIds(): string[] {
    return this.listIds();
  }

  getAllPluginsMetadata(): EligibilityPluginMetadata[] {
    return this.list()
      .filter((p) => !p.hidden)
      .map((p) => this.toManifestEntry(p));
  }

  async recomputeWorkerForAllPlugins(workerId: string): Promise<void> {
    for (const plugin of this.getEnabledPlugins()) {
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
}

export const dispatchEligPluginRegistry = new DispatchEligPluginRegistry();
