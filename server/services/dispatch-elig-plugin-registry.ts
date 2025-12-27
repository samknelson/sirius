import { logger } from "../logger";
import { isComponentEnabledSync } from "./component-cache";

export interface DispatchEligPlugin {
  id: string;
  componentId: string;
  recomputeWorker(workerId: string): Promise<void>;
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
}

export const dispatchEligPluginRegistry = new DispatchEligPluginRegistry();
