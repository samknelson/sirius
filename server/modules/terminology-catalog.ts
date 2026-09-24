import { registerCatalog } from "@shared/catalog";
import { TERMINOLOGY_CATALOG } from "@shared/catalog-ids";
import { TERM_REGISTRY, termDefaultsDetail } from "@shared/terminology";

/**
 * The renameable terms, as a shared catalog.
 *
 * Kept out of ./terminology.ts for the same reason the options catalog is kept
 * out of its registry: that module is imported by the variable registry on the
 * boot path and should not pick up a registration side effect on import.
 *
 * `TERM_REGISTRY` is the declaration this projects, and it is not the only
 * projection of it. The app-wide term resolver keeps reading the same
 * declaration directly, compiled in and synchronous, because it renders on
 * every page and must not wait for a request to know what a worker is called.
 * The stored-value validation reads it directly too — deciding whether a saved
 * term key is still recognized is interpreting stored data, which belongs to
 * the unfiltered declaration rather than to a filtered offer. This catalog
 * serves the screens that *enumerate* terms: the config page and the catalog
 * browser.
 *
 * Everything here is public. The default wording already ships inside the
 * client bundle every visitor downloads, so there is nothing to place behind a
 * restricted tier and no honest permission to gate it with — `signed-in`
 * matches the endpoint this replaces, and the config page stays admin-gated by
 * its own route.
 */

export function registerTerminologyCatalog(): void {
  registerCatalog({
    id: TERMINOLOGY_CATALOG,
    label: "Terminology",
    description:
      "The terms a deployment can rename to match its own vocabulary. The " +
      "wording in effect is configured data; that a term can be renamed is not.",
    audience: "signed-in",
    // Declaration order, not alphabetical: it is the order the config screen
    // has always listed them in, and it groups the people-shaped terms before
    // the field-shaped one.
    entries: () =>
      Object.values(TERM_REGISTRY).map((definition) => ({
        id: definition.key,
        name: definition.label,
        description: definition.description,
        detail: termDefaultsDetail(definition.defaults),
      })),
  });
}
