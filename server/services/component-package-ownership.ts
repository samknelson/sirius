import { getAllComponents, getComponentById } from "@shared/components";
import { componentPackageIds } from "@shared/generated/component-packages";
import { absentOwnedTables, type ComponentOwnership } from "@shared/component-package-ownership";
import { componentPackageOwnershipStorage } from "../storage/system/component-package-ownership";

export async function recordInstalledPackageOwnership(): Promise<void> {
  const installed: ComponentOwnership = {};
  for (const definition of getAllComponents()) {
    const packageId = componentPackageIds[definition.id];
    if (packageId) installed[definition.id] = {
      packageId, definition, tables: definition.schemaManifest?.tables ?? [],
    };
  }
  await componentPackageOwnershipStorage.record(installed);
}

export async function getAbsentPackageTables(): Promise<Set<string>> {
  return absentOwnedTables(await componentPackageOwnershipStorage.read(), new Set(getAllComponents().map(c => c.id)));
}

export async function getAbsentPackageComponents() {
  return Object.entries(await componentPackageOwnershipStorage.read())
    .filter(([id]) => !getComponentById(id));
}
