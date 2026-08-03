import { logger } from "../../../logger";
import { PluginRegistry } from "../../_core";
import type { DataRetentionPlugin, DataRetentionManifestEntry } from "./types";

/**
 * Registry of data-retention plugins. Reuses the generic `PluginRegistry`
 * scaffolding (component gating, access-policy gating, manifest shaping) so
 * retention plugins are first-class plugins like every other kind. Metadata
 * is nested under `.metadata`, matching the cron / denorm convention.
 */
export const dataRetentionPluginRegistry = new PluginRegistry<
  DataRetentionPlugin,
  DataRetentionManifestEntry
>({
  kind: "data-retention",
  getMetadata: (p) => p.metadata,
  toManifestEntry: (p) => ({ ...p.metadata }),
});

/** Self-registration helper used by each plugin file under `./plugins/`. */
export function registerDataRetentionPlugin(plugin: DataRetentionPlugin): void {
  dataRetentionPluginRegistry.register(plugin);
  logger.info(`Registered data-retention plugin: ${plugin.metadata.id}`, {
    service: "data-retention-registry",
  });
}

export function getDataRetentionPlugin(id: string): DataRetentionPlugin | undefined {
  return dataRetentionPluginRegistry.get(id);
}
