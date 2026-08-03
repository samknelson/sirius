import { PluginRegistry } from "../../_core/registry";
import type { BasePluginMetadata } from "../../_core/types";
import type { SystemStatusPlugin, SystemStatusManifestEntry } from "./types";

function pluginToMetadata(p: SystemStatusPlugin): BasePluginMetadata {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
    needsReadOnlyDb: p.needsReadOnlyDb,
  };
}

function pluginToManifestEntry(p: SystemStatusPlugin): SystemStatusManifestEntry {
  return {
    ...pluginToMetadata(p),
    scanMode: p.scanMode ?? "scan-and-cache",
  };
}

/**
 * Registry for system-status plugins. Pure metadata + gating scaffolding
 * from the shared PluginRegistry; all scan execution and result caching
 * lives in the collector (`collector.ts`).
 */
export const systemStatusPluginRegistry = new PluginRegistry<
  SystemStatusPlugin,
  SystemStatusManifestEntry
>({
  kind: "system-status",
  getMetadata: pluginToMetadata,
  toManifestEntry: pluginToManifestEntry,
});

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerDashboardPlugin` / `registerCronPlugin`.
 */
export function registerSystemStatusPlugin(plugin: SystemStatusPlugin): void {
  systemStatusPluginRegistry.register(plugin);
}
