import { PluginRegistry } from "../_core/registry";
import type { BasePluginMetadata } from "../_core/types";
import type { JsonSchema } from "@shared/json-schema-form";
import type { WorkerListPlugin } from "./types";

/** Manifest entry shape served by /api/plugins/worker-list/manifest. */
export interface WorkerListManifestEntry extends BasePluginMetadata {
  configSchema?: JsonSchema;
}

export const workerListPluginRegistry = new PluginRegistry<
  WorkerListPlugin,
  WorkerListManifestEntry
>({
  kind: "worker-list",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => ({
    ...plugin.metadata,
    configSchema: plugin.configSchema,
  }),
});

export function registerWorkerListPlugin(plugin: WorkerListPlugin): void {
  workerListPluginRegistry.register(plugin);
}
