import { logger } from "../logger";
import { isComponentEnabledSync } from "./component-cache";
import type { EligibilityPluginMetadata, EligibilityPluginConfig } from "@shared/schema";

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
   */
  type: "exists" | "not_exists" | "exists_or_none";
  /** The value to check. Can be a static value or derived from job context */
  value: string;
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

export interface DispatchEligPlugin {
  id: string;
  name: string;
  description: string;
  componentId: string;
  recomputeWorker(workerId: string): Promise<void>;
  /**
   * Returns the eligibility condition this plugin contributes to the query.
   * Called when building the eligible workers query for a job.
   * @param context - Information about the job being queried
   * @param config - Per-plugin configuration from the job type
   * @returns The condition to add to the query, or null if no condition needed
   */
  getEligibilityCondition(context: EligibilityQueryContext, config: EligibilityPluginConfig["config"]): EligibilityCondition | null;
}

class DispatchEligPluginRegistry {
  private plugins = new Map<string, DispatchEligPlugin>();

  register(plugin: DispatchEligPlugin): void {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Dispatch eligibility plugin ${plugin.id} already registered, overwriting`, {
        service: "dispatch-elig-registry",
      });
    }
    this.plugins.set(plugin.id, plugin);
    logger.info(`Dispatch eligibility plugin registered: ${plugin.id}`, {
      service: "dispatch-elig-registry",
    });
  }

  unregister(pluginId: string): boolean {
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
    }));
  }
}

export const dispatchEligPluginRegistry = new DispatchEligPluginRegistry();
