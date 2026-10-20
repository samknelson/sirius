import type { ResolvedCatalogEntry } from "./catalog";

/** Code-supplied definitions, never saved configuration or runtime state. */
export interface PluginDefinitionCatalog {
  kind: string;
  label: string;
  description?: string;
  configurationPath?: string;
  entries: ResolvedCatalogEntry[];
}
