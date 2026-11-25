import { getAllComponents, getComponentById } from "@shared/components";
import { optionalComponentIds } from "@shared/generated/optional-components";
import { absentOwnedTables, type ComponentOwnership } from "@shared/component-ownership";
import { componentOwnershipStorage } from "../storage/system/component-ownership";

export async function recordInstalledComponentOwnership(): Promise<void> {
  const installed: ComponentOwnership = {};
  for (const definition of getAllComponents()) {
    if (optionalComponentIds.has(definition.id)) installed[definition.id] = {
      definition, tables: definition.schemaManifest?.tables ?? [],
    };
  }
  await componentOwnershipStorage.record(installed);
}

export async function getAbsentComponentTables(): Promise<Set<string>> {
  return absentOwnedTables(await componentOwnershipStorage.read(), new Set(getAllComponents().map(c => c.id)));
}

export async function getAbsentComponents() {
  return Object.entries(await componentOwnershipStorage.read())
    .filter(([id]) => !getComponentById(id));
}
