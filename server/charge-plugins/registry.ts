import { ChargePlugin } from "./base";
import { logger } from "../logger";
import type { TriggerType } from "./types";

export interface RegisteredChargePlugin {
  id: string;
  plugin: ChargePlugin;
  metadata: ChargePlugin['metadata'];
}

class ChargePluginRegistry {
  private plugins: Map<string, ChargePlugin> = new Map();

  register(plugin: ChargePlugin): void {
    const id = plugin.metadata.id;
    if (this.plugins.has(id)) {
      throw new Error(`Charge plugin "${id}" is already registered`);
    }
    this.plugins.set(id, plugin);
    logger.info(`Registered charge plugin: ${id}`, { 
      service: 'charge-plugin-registry',
      triggers: plugin.metadata.triggers,
    });
  }

  get(id: string): ChargePlugin | undefined {
    return this.plugins.get(id);
  }

  getAll(): RegisteredChargePlugin[] {
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

  getByTrigger(trigger: TriggerType): ChargePlugin[] {
    return Array.from(this.plugins.values()).filter(plugin => 
      plugin.canHandle(trigger)
    );
  }
}

export const chargePluginRegistry = new ChargePluginRegistry();

export function registerChargePlugin(plugin: ChargePlugin): void {
  chargePluginRegistry.register(plugin);
}

export function getChargePlugin(id: string): ChargePlugin | undefined {
  return chargePluginRegistry.get(id);
}

export function getAllChargePlugins(): RegisteredChargePlugin[] {
  return chargePluginRegistry.getAll();
}

export function getChargePluginsByTrigger(trigger: TriggerType): ChargePlugin[] {
  return chargePluginRegistry.getByTrigger(trigger);
}
