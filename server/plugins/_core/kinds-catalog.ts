import { registerCatalog } from "@shared/catalog";
import { PLUGIN_KINDS_CATALOG } from "@shared/catalog-ids";
import {
  getPluginConfigAdapter,
  listPluginConfigAdapters,
} from "./config-adapter";
import {
  getPluginKind,
  listPluginKindRegistrations,
} from "./kinds";

/** Derive a human-readable label from a kind id. */
function prettifyKind(kind: string): string {
  return kind
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The serializable projection of the executable plugin-kind registry.
 *
 * The registry remains responsible for runtime behavior and callbacks. This
 * catalog is the one list-shaped answer exposed to readers, derived on every
 * read so late kind/adapter registration and component changes are reflected.
 */
export function registerPluginKindsCatalog(): void {
  for (const kind of listPluginConfigAdapters()) {
    if (!getPluginKind(kind)) {
      throw new Error(
        `Plugin config adapter '${kind}' has no plugin-kind registration.`,
      );
    }
  }

  registerCatalog({
    id: PLUGIN_KINDS_CATALOG,
    label: "Plugin Kinds",
    description:
      "The kinds of plugins this deployment provides and whether each kind supports stored configuration.",
    audience: "gated",
    viewPermission: "admin",
    entries: () =>
      listPluginKindRegistrations()
        .map((registration) => ({
          id: registration.kind,
          name: registration.label ?? prettifyKind(registration.kind),
          ...(registration.description !== undefined
            ? { description: registration.description }
            : {}),
          ...(registration.requiredComponent !== undefined
            ? { component: registration.requiredComponent }
            : {}),
          detail: {
            configurable: getPluginConfigAdapter(registration.kind) !== undefined,
          },
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
  });
}