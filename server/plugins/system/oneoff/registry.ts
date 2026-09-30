import { logger } from "../../../logger";
import { PluginRegistry } from "../../_core";
import type { OneoffPlugin } from "./types";

export const oneoffPluginRegistry = new PluginRegistry<OneoffPlugin>({
  kind: "oneoff",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => ({
    ...plugin.metadata,
    actions: plugin.actions.map(({ id, label, description, destructive, background }) => ({
      id,
      label,
      description,
      destructive,
      background,
    })),
  }),
});

export function registerOneoffPlugin(plugin: OneoffPlugin): void {
  oneoffPluginRegistry.register(plugin);
  logger.info(`Registered oneoff plugin: ${plugin.metadata.id}`, {
    service: "oneoff-registry",
  });
}

export function getOneoffPlugin(id: string): OneoffPlugin | undefined {
  return oneoffPluginRegistry.get(id);
}