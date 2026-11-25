import { registerCatalog } from "@shared/catalog";
import { isComponentEnabledSync } from "../../services/component/cache";
import { pluginDefinitionEntry } from "./definition-catalog";
import { listPluginKindRegistrations } from "./kinds";
import { prettifyKind } from "./kinds-catalog";

/**
 * Run after all startup kind registrations, before catalogs close. Each kind
 * contributes an ordinary declaration; registerCatalog rejects ID collisions.
 * No plugin access-policy evaluation or runtime decoration belongs in this read.
 */
export function registerPluginCatalogs(): void {
  for (const registration of listPluginKindRegistrations()) {
    registerCatalog({
      id: `${registration.kind}-plugins`,
      label: registration.label ?? `${prettifyKind(registration.kind)} Plugins`,
      description: registration.description,
      audience: "gated",
      viewPermission: "admin",
      entries: () => {
        if (
          registration.requiredComponent &&
          !isComponentEnabledSync(registration.requiredComponent)
        ) return [];

        return registration.registry.list()
          .filter((plugin) => !registration.registry.getMetadata(plugin).hidden)
          .map((plugin) => pluginDefinitionEntry(
            registration.registry.getMetadata(plugin),
            registration.registry.toManifestEntry(plugin),
          ))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    });
  }
}
