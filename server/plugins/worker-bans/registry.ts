import { logger } from "../../logger";
import { PluginRegistry, isPluginComponentEnabledSync } from "../_core";
import type { BasePluginMetadata } from "../_core";
import type { WorkerBan } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";
import type { BannableActionId } from "./actions";
import { getBannableActionName } from "./actions";

/**
 * Context supplied by an enforcement point when checking a ban. Keys are
 * optional — a plugin whose match logic needs a key it doesn't receive
 * simply does not match (bans fail open per-plugin, closed per-action via
 * the unconditional plugins).
 */
export interface BanCheckContext {
  facilityId?: string;
  jobTypeId?: string | null;
  [key: string]: unknown;
}

/**
 * A worker-ban plugin. Singleton (one registration per behavior, no
 * per-deployment configuration rows); admin-facing configuration happens on
 * the "Worker Ban Types" options page, where each ban type multi-selects the
 * plugins it applies.
 */
export interface WorkerBanPlugin extends BasePluginMetadata {
  /** Bannable actions this plugin denies. */
  actions: readonly BannableActionId[];
  /**
   * JSON Schema for the per-ban argument payload stored in
   * `worker_bans.data` (e.g. the facility a facility ban applies to).
   * Omitted for unconditional plugins.
   */
  argumentSchema?: JsonSchema;
  /**
   * Optional match predicate — given the ban record and the enforcement
   * context, decide whether this ban applies. When omitted the plugin is
   * unconditional: any active ban of a type including it denies its
   * actions outright (this is also what marks the ban for the dispatch
   * eligibility denorm facts).
   */
  matches?(ban: WorkerBan, action: BannableActionId, context: BanCheckContext): boolean;
}

export interface WorkerBanManifestEntry {
  id: string;
  name: string;
  description?: string;
  componentId: string;
  componentEnabled: boolean;
  actions: readonly string[];
  actionNames: string[];
  argumentSchema?: JsonSchema;
  /** True when the plugin has no match predicate (bans its actions outright). */
  unconditional: boolean;
}

function pluginToMetadata(p: WorkerBanPlugin): BasePluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    hidden: p.hidden,
    singleton: true,
  };
}

function pluginToManifestEntry(p: WorkerBanPlugin): WorkerBanManifestEntry {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    componentId: p.requiredComponent ?? "",
    componentEnabled: isPluginComponentEnabledSync(p),
    actions: p.actions,
    actionNames: p.actions.map(getBannableActionName),
    argumentSchema: p.argumentSchema,
    unconditional: !p.matches,
  };
}

class WorkerBanPluginRegistry extends PluginRegistry<WorkerBanPlugin, WorkerBanManifestEntry> {
  constructor() {
    super({
      kind: "worker-ban",
      getMetadata: pluginToMetadata,
      toManifestEntry: pluginToManifestEntry,
      allowOverwrite: true,
    });
  }
}

export const workerBanPluginRegistry = new WorkerBanPluginRegistry();

export function registerWorkerBanPlugin(plugin: WorkerBanPlugin): void {
  workerBanPluginRegistry.register(plugin);
  logger.info(`Worker-ban plugin registered: ${plugin.id}`, {
    service: "worker-ban-registry",
  });
}
