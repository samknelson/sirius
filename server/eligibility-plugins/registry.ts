import { EligibilityPlugin } from "./base";
import { logger } from "../logger";

export interface RegisteredEligibilityPlugin {
  id: string;
  plugin: EligibilityPlugin;
  metadata: EligibilityPlugin['metadata'];
}

class EligibilityPluginRegistry {
  private plugins: Map<string, EligibilityPlugin> = new Map();

  register(plugin: EligibilityPlugin): void {
    const id = plugin.metadata.id;
    if (this.plugins.has(id)) {
      throw new Error(`Eligibility plugin "${id}" is already registered`);
    }
    this.plugins.set(id, plugin);
    logger.info(`Registered eligibility plugin: ${id}`, { 
      service: 'eligibility-plugin-registry',
    });
  }

  get(id: string): EligibilityPlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): RegisteredEligibilityPlugin[] {
    return Array.from(this.plugins.entries()).map(([id, plugin]) => ({
      id,
      plugin,
      metadata: plugin.metadata,
    }));
  }

  getAllIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }
}

export const eligibilityPluginRegistry = new EligibilityPluginRegistry();

export function registerEligibilityPlugin(plugin: EligibilityPlugin): void {
  eligibilityPluginRegistry.register(plugin);
}

export function getEligibilityPlugin(id: string): EligibilityPlugin | undefined {
  return eligibilityPluginRegistry.get(id);
}

export function getAllEligibilityPlugins(): RegisteredEligibilityPlugin[] {
  return eligibilityPluginRegistry.getAll();
}
