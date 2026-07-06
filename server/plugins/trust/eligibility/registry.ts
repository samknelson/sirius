import { EligibilityPlugin } from "./base";
import { logger } from "../../../logger";
import type { EligibilityPluginMetadata as TrustEligibilityMetadata } from "./types";
import { PluginRegistry } from "../../_core";
import type { BasePluginMetadata } from "../../_core";

export interface RegisteredEligibilityPlugin {
  id: string;
  plugin: EligibilityPlugin;
  metadata: EligibilityPlugin["metadata"];
}

function pluginToBaseMetadata(p: EligibilityPlugin): BasePluginMetadata {
  return {
    id: p.metadata.id,
    name: p.metadata.name,
    description: p.metadata.description,
    requiredComponent: p.metadata.requiredComponent,
    needsReadOnlyDb: p.metadata.needsReadOnlyDb,
  };
}

interface TrustEligibilityManifestEntry {
  id: string;
  name: string;
  description: string;
  configSchema: TrustEligibilityMetadata["configSchema"];
  requiredComponent?: string;
  needsReadOnlyDb?: boolean;
}

function pluginToManifestEntry(p: EligibilityPlugin): TrustEligibilityManifestEntry {
  return {
    id: p.metadata.id,
    name: p.metadata.name,
    description: p.metadata.description,
    configSchema: p.metadata.configSchema,
    requiredComponent: p.metadata.requiredComponent,
    needsReadOnlyDb: p.metadata.needsReadOnlyDb,
  };
}

class EligibilityPluginRegistry extends PluginRegistry<EligibilityPlugin, TrustEligibilityManifestEntry> {
  constructor() {
    super({
      kind: "trust-eligibility",
      getMetadata: pluginToBaseMetadata,
      toManifestEntry: pluginToManifestEntry,
    });
  }

  register(plugin: EligibilityPlugin): void {
    super.register(plugin);
    logger.info(`Registered eligibility plugin: ${plugin.metadata.id}`, {
      service: "eligibility-plugin-registry",
    });
  }

  getAll(): RegisteredEligibilityPlugin[] {
    return this.list().map((plugin) => ({
      id: plugin.metadata.id,
      plugin,
      metadata: plugin.metadata,
    }));
  }

  getAllFiltered(enabledComponents: string[]): RegisteredEligibilityPlugin[] {
    return this.getAll().filter((p) => {
      const required = p.metadata.requiredComponent;
      if (!required) return true;
      return enabledComponents.includes(required);
    });
  }

  getAllIds(): string[] {
    return this.listIds();
  }

  isPluginEnabled(id: string, enabledComponents: string[]): boolean {
    const plugin = this.get(id);
    if (!plugin) return false;
    const required = plugin.metadata.requiredComponent;
    if (!required) return true;
    return enabledComponents.includes(required);
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
