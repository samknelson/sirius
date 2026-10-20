import { PluginRegistry } from "../../_core/registry";
import { floodConfigSchema, floodSettingsSchema, type FloodPlugin } from "./types";

export const floodPluginRegistry = new PluginRegistry({
  kind: "flood",
  getMetadata: (plugin: FloodPlugin) => plugin,
  toManifestEntry: (plugin: FloodPlugin) => ({
    id: plugin.id, name: plugin.name, description: plugin.description,
    singleton: plugin.singleton, requiredComponent: plugin.requiredComponent,
    defaults: plugin.defaults,
    configSchema: plugin.configSchema?.() ?? floodConfigSchema(plugin),
    uiSchema: plugin.uiSchema?.(),
  }),
});

export function registerFloodPlugin(plugin: FloodPlugin): void {
  floodSettingsSchema.parse(plugin.defaults);
  floodPluginRegistry.register(plugin);
}
