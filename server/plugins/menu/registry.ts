import { PluginRegistry } from "../_core/registry";
import type { MenuManifestEntry, MenuPlugin } from "./types";

export const menuPluginRegistry = new PluginRegistry<MenuPlugin, MenuManifestEntry>({
  kind: "menu",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => ({
    id: plugin.metadata.id,
    name: plugin.metadata.name,
    description: plugin.metadata.description,
  }),
});

export function registerMenuPlugin(plugin: MenuPlugin): void {
  menuPluginRegistry.register(plugin);
}
