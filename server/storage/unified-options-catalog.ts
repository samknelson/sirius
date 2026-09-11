import { registerCatalog } from "@shared/catalog";
import { OPTIONS_LISTS_CATALOG } from "@shared/catalog-ids";
import { optionsMetadata, type OptionsTypeName } from "./unified-options";

/**
 * The options lists, as a shared catalog.
 *
 * Kept out of ./unified-options.ts for the same reason the record-history
 * catalog is kept out of its registry: that module is on the storage path and
 * should not pick up a registration side effect on import.
 *
 * `optionsMetadata` is the declaration this projects. Most of what it holds is
 * not a client's business and is not carried here — the Drizzle table, the
 * field definitions, the schema/uiSchema payloads, the logging module. What is
 * left is what a caller needs to decide whether to offer the list and what to
 * call it when it does.
 *
 * Audience is `signed-in` rather than `gated`: the names of the deployment's
 * dropdown lists are not themselves sensitive, and every reader of this — the
 * sidebar, the Config landing page, the options index — is already behind
 * sign-in. Reading a list's *records* is a separate decision, made by the
 * options routes, and nothing here grants it.
 */

export function registerOptionsListsCatalog(): void {
  registerCatalog({
    id: OPTIONS_LISTS_CATALOG,
    label: "Options Lists",
    description:
      "The configurable dropdown lists this deployment offers. What is in one " +
      "is configured data; that this one exists is not.",
    audience: "signed-in",
    entries: () =>
      (Object.keys(optionsMetadata) as OptionsTypeName[])
        .map((type) => {
          const metadata = optionsMetadata[type];
          return {
            id: type,
            name: metadata.displayName,
            ...(metadata.description !== undefined
              ? { description: metadata.description }
              : {}),
            ...(metadata.requiredComponent !== undefined
              ? { component: metadata.requiredComponent }
              : {}),
            detail: {
              // The plural is a separate word, not a suffix: "Skills" but also
              // "Worker Ban Types" and "Gender". A screen listing the records
              // needs it and cannot derive it.
              pluralName: metadata.pluralName,
              // `null` is a real answer, and the common one: most lists have no
              // page of their own and are administered on the generic screen.
              bespokePath: metadata.bespokePath ?? null,
            },
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
