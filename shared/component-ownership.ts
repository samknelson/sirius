import type { ComponentDefinition } from "./components";

/** Retained ownership of optional components, keyed by component ID. */
export const COMPONENT_OWNERSHIP_VARIABLE = "component_ownership";
/**
 * The variable earlier builds wrote, when an optional "package" could hold
 * several components. Its entries carry a `packageId` that no longer means
 * anything; they are read (and normalized) but never written.
 */
export const LEGACY_COMPONENT_OWNERSHIP_VARIABLE = "component_package_ownership";

export interface RetainedComponentOwnership {
  definition: ComponentDefinition;
  tables: string[];
}

export type ComponentOwnership = Record<string, RetainedComponentOwnership>;

/**
 * Invalid ownership must stop the operation, never silently allow table deletion.
 * Legacy entries (with a `packageId`, including `"legacy"`) are accepted and
 * normalized to the per-component shape.
 */
export function parseComponentOwnership(value: unknown): ComponentOwnership {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid retained component ownership");
  }
  const parsed: ComponentOwnership = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" ||
      ("packageId" in entry && typeof entry.packageId !== "string") ||
      entry.definition?.id !== id || typeof entry.definition.name !== "string" ||
      typeof entry.definition.description !== "string" || typeof entry.definition.enabledByDefault !== "boolean" ||
      !Array.isArray(entry.tables) || entry.tables.some((table: unknown) => typeof table !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table))) {
      throw new Error(`Invalid retained component ownership for ${id}`);
    }
    parsed[id] = { definition: entry.definition, tables: entry.tables };
  }
  return parsed;
}

export function absentOwnedTables(ownership: ComponentOwnership, installedIds: ReadonlySet<string>): Set<string> {
  return new Set(Object.entries(ownership)
    .filter(([id]) => !installedIds.has(id))
    .flatMap(([, entry]) => entry.tables));
}
