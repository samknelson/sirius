import type { CatalogDetail, CatalogValue, ResolvedCatalogEntry } from "@shared/catalog";
import type { BasePluginMetadata } from "./types";

/**
 * Copy only JSON descriptions. Never call toJSON or serialize executable
 * objects from a registration; callbacks and class instances (e.g. a token's
 * Drizzle table) remain in the plugin framework.
 */
function describe(value: unknown, ancestors = new Set<object>()): CatalogValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite plugin catalog attribute");
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if (ancestors.has(value)) throw new Error("Circular plugin catalog attribute");
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    ancestors.add(value);
    try {
      // Reading descriptors, rather than values, also avoids executing getters.
      const properties = Object.getOwnPropertyDescriptors(value);
      if (Array.isArray(value)) {
        return Array.from({ length: value.length }, (_, index) => {
          const property = properties[index];
          return property && "value" in property
            ? describe(property.value, ancestors) ?? null
            : null;
        });
      }
      return Object.fromEntries(
        Object.entries(properties).flatMap(([key, property]) => {
          if (!property.enumerable || !("value" in property)) return [];
          const description = describe(property.value, ancestors);
          return description === undefined ? [] : [[key, description]];
        }),
      );
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "bigint") throw new Error("Non-JSON plugin catalog attribute");
  return undefined;
}

/** Use the existing, undecorated manifest projection, not the executable plugin. */
export function pluginDefinitionEntry(
  metadata: BasePluginMetadata,
  manifest: unknown,
): ResolvedCatalogEntry {
  const projection = describe(manifest);
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error("Plugin manifest description must be an object");
  }
  // Some manifests carry an `enabled` placeholder that runtime decoration
  // replaces. Its declared counterpart is enabledByDefault/defaultEnabled.
  const { id, name, description, requiredComponent, enabled, ...attributes } = projection;
  const detail = describe({
    ...attributes,
    requiredPolicy: metadata.requiredPolicy,
    singleton: metadata.singleton ?? false,
    needsReadOnlyDb: metadata.needsReadOnlyDb ?? false,
  }) as CatalogDetail;
  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    ...(metadata.requiredComponent ? { component: metadata.requiredComponent } : {}),
    detail,
  };
}
