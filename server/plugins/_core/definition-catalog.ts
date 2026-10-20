import type { CatalogDetail, CatalogValue, ResolvedCatalogEntry } from "@shared/catalog";
import type { BasePluginMetadata } from "./types";

/**
 * Copy only JSON descriptions. Never call toJSON or serialize executable
 * objects from a registration; callbacks remain in the plugin framework.
 */
function describe(value: unknown): CatalogValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite plugin catalog attribute");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => describe(item) ?? null);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Plugin catalog attributes must be plain JSON objects");
    }
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const description = describe(item);
        return description === undefined ? [] : [[key, description]];
      }),
    );
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
