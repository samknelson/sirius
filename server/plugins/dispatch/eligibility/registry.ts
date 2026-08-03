import { logger } from "../../../logger";
import { PluginRegistry, isPluginComponentEnabledSync } from "../../_core";
import type { BasePluginMetadata } from "../../_core";
import type { EligibilityPluginMetadata, EligibilityPluginConfig } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";

/**
 * Represents a condition that a plugin contributes to the eligible workers query.
 * Each condition specifies how to check the worker_dispatch_elig_denorm table.
 */
export interface EligibilityCondition {
  category: string;
  type: "exists" | "not_exists" | "exists_or_none" | "not_exists_category" | "exists_all" | "not_exists_unless_exists" | "exists_or_exists";
  value: string;
  values?: string[];
  unlessCategory?: string;
  unlessValue?: string;
  /** For `exists_or_exists`: the alternative fact that also satisfies the condition. */
  orCategory?: string;
  orValue?: string;
  /**
   * Optional human-readable explanation shown when this condition FAILS for a
   * worker. When omitted, a generic template built from category/values is
   * used instead.
   */
  failureMessage?: string;
}

export interface EligibilityQueryContext {
  jobId: string;
  employerId: string;
  jobTypeId: string | null;
}

/**
 * A dispatch-eligibility plugin — READ side only.
 *
 * Each plugin contributes a query condition (`getEligibilityCondition`) over the
 * `worker_dispatch_elig_denorm` facts to filter workers for a job. The WRITE
 * side (maintaining those facts) now lives in the denorm plugin framework under
 * `server/plugins/system/denorm/plugins/dispatch/*`; the `category`/`value`
 * names are the single point of coupling between the two sides.
 */
export interface DispatchEligPlugin extends BasePluginMetadata {
  configSchema?: JsonSchema;
  getEligibilityCondition(
    context: EligibilityQueryContext,
    config: EligibilityPluginConfig["config"],
  ): EligibilityCondition | EligibilityCondition[] | null | Promise<EligibilityCondition | EligibilityCondition[] | null>;
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
    componentEnabled: isPluginComponentEnabledSync(p),
    configSchema: p.configSchema,
  };
}

class DispatchEligPluginRegistry extends PluginRegistry<DispatchEligPlugin, EligibilityPluginMetadata> {
  constructor() {
    super({
      kind: "dispatch-eligibility",
      getMetadata: pluginToMetadata,
      toManifestEntry: pluginToManifestEntry,
      allowOverwrite: true,
    });
  }

  register(plugin: DispatchEligPlugin): void {
    super.register(plugin);
    logger.info(`Dispatch eligibility plugin registered: ${plugin.id}`, {
      service: "dispatch-elig-registry",
    });
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
}

export const dispatchEligPluginRegistry = new DispatchEligPluginRegistry();

/**
 * Convenience helper used by individual plugin files to self-register
 * at module top level. Mirrors `registerChargePlugin` / `registerEligibilityPlugin`.
 */
export function registerDispatchEligPlugin(plugin: DispatchEligPlugin): void {
  dispatchEligPluginRegistry.register(plugin);
}
