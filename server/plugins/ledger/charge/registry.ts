import { ChargePlugin } from "./base";
import { logger } from "../../../logger";
import type { TriggerType, ChargePluginMetadata } from "./types";
import { PluginRegistry } from "../../_core";
import type { BasePluginMetadata } from "../../_core";

export interface RegisteredChargePlugin {
  id: string;
  plugin: ChargePlugin;
  metadata: ChargePluginMetadata;
}

function pluginToBaseMetadata(p: ChargePlugin): BasePluginMetadata {
  return {
    id: p.metadata.id,
    name: p.metadata.name,
    description: p.metadata.description,
    requiredComponent: p.metadata.requiredComponent,
    needsReadOnlyDb: p.metadata.needsReadOnlyDb,
  };
}

/**
 * Shape served to the client at GET /api/plugins/charge/manifest. We
 * return an explicit subset (mirroring the eligibility registry) so the
 * client gets the JSON `configSchema` it renders with RJSF — and never
 * any non-serializable runtime-only metadata.
 */
export interface ChargePluginManifestEntry {
  id: string;
  name: string;
  description: string;
  triggers: TriggerType[];
  defaultScope: "global" | "employer";
  supportedScopes: readonly ("global" | "employer")[];
  configSchema?: ChargePluginMetadata["configSchema"];
  requiredComponent?: string;
  needsReadOnlyDb?: boolean;
}

function pluginToManifestEntry(p: ChargePlugin): ChargePluginManifestEntry {
  return {
    id: p.metadata.id,
    name: p.metadata.name,
    description: p.metadata.description,
    triggers: p.metadata.triggers,
    defaultScope: p.metadata.defaultScope,
    supportedScopes: p.metadata.supportedScopes ?? ["global"],
    configSchema: p.metadata.configSchema,
    requiredComponent: p.metadata.requiredComponent,
    needsReadOnlyDb: p.metadata.needsReadOnlyDb,
  };
}

class ChargePluginRegistry extends PluginRegistry<ChargePlugin, ChargePluginManifestEntry> {
  constructor() {
    super({
      kind: "charge",
      getMetadata: pluginToBaseMetadata,
      toManifestEntry: pluginToManifestEntry,
    });
  }

  register(plugin: ChargePlugin): void {
    super.register(plugin);
    logger.info(`Registered charge plugin: ${plugin.metadata.id}`, {
      service: "charge-plugin-registry",
      triggers: plugin.metadata.triggers,
      requiredComponent: plugin.metadata.requiredComponent,
    });
  }

  getAll(): RegisteredChargePlugin[] {
    return this.list().map((plugin) => ({
      id: plugin.metadata.id,
      plugin,
      metadata: plugin.metadata,
    }));
  }

  async getAllEnabled(): Promise<RegisteredChargePlugin[]> {
    const enabled = await this.listEnabledAsync();
    return enabled.map((plugin) => ({
      id: plugin.metadata.id,
      plugin,
      metadata: plugin.metadata,
    }));
  }

  getAllIds(): string[] {
    return this.listIds();
  }

  getByTrigger(trigger: TriggerType): ChargePlugin[] {
    return this.list().filter((plugin) => plugin.canHandle(trigger));
  }

  async getEnabledByTrigger(trigger: TriggerType): Promise<ChargePlugin[]> {
    const enabled = await this.listEnabledAsync();
    return enabled.filter((plugin) => plugin.canHandle(trigger));
  }

  isPluginEnabled(id: string): Promise<boolean> {
    return this.isEnabledAsync(id);
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

export async function getAllEnabledChargePlugins(): Promise<RegisteredChargePlugin[]> {
  return chargePluginRegistry.getAllEnabled();
}

export function getChargePluginsByTrigger(trigger: TriggerType): ChargePlugin[] {
  return chargePluginRegistry.getByTrigger(trigger);
}

export async function getEnabledChargePluginsByTrigger(trigger: TriggerType): Promise<ChargePlugin[]> {
  return chargePluginRegistry.getEnabledByTrigger(trigger);
}

export async function isChargePluginEnabled(id: string): Promise<boolean> {
  return chargePluginRegistry.isPluginEnabled(id);
}
