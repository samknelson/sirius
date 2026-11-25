import type { ComponentDefinition } from "./components";

export const PACKAGE_OWNERSHIP_VARIABLE = "component_package_ownership";

export interface RetainedComponentOwnership {
  packageId: string;
  definition: ComponentDefinition;
  tables: string[];
}

export type ComponentOwnership = Record<string, RetainedComponentOwnership>;

/** Invalid ownership must stop the operation, never silently allow table deletion. */
export function parseComponentOwnership(value: unknown): ComponentOwnership {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid retained component package ownership");
  }
  for (const [id, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || typeof entry.packageId !== "string" ||
      entry.definition?.id !== id || typeof entry.definition.name !== "string" ||
      typeof entry.definition.description !== "string" || typeof entry.definition.enabledByDefault !== "boolean" ||
      !Array.isArray(entry.tables) || entry.tables.some((table: unknown) => typeof table !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table))) {
      throw new Error(`Invalid retained package ownership for ${id}`);
    }
  }
  return value as ComponentOwnership;
}

export function absentOwnedTables(ownership: ComponentOwnership, installedIds: ReadonlySet<string>): Set<string> {
  return new Set(Object.entries(ownership)
    .filter(([id]) => !installedIds.has(id))
    .flatMap(([, entry]) => entry.tables));
}
