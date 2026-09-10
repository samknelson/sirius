/**
 * Shared catalog framework.
 *
 * One way to declare a code-supplied list of what this deployment offers, and
 * one way to read it. See `types.ts` for the line this draws between a catalog
 * and the configured state that stays where it is.
 *
 * This barrel has no dependencies outside its own directory, so it is safe to
 * import from anywhere, including the boot path.
 */

export type {
  CatalogAccess,
  CatalogAudience,
  CatalogDefinition,
  CatalogDetail,
  CatalogEntry,
  CatalogReadResult,
  CatalogSummary,
  CatalogTier,
  CatalogValue,
  CatalogViewer,
  CatalogVocabulary,
  CatalogVocabularyEntry,
  ResolvedCatalog,
  ResolvedCatalogEntry,
} from "./types";

export { ANONYMOUS_VIEWER } from "./types";

export type { CatalogComponentSource } from "./component";

export {
  clearCatalogComponentSource,
  getCatalogComponentRevision,
  hasCatalogComponentSource,
  isCatalogComponentEnabled,
  setCatalogComponentSource,
} from "./component";

/**
 * Note what is absent below, and why.
 *
 * `deriveCatalogEntries` and `resolveCatalog` hand back entries at a tier the
 * caller names, which makes handing out restricted detail a one-argument
 * mistake. `getCatalogDefinition` and `listCatalogDefinitions` are worse: a
 * declaration carries its own `entries()` producer, so holding one is holding
 * the raw entries, restricted payloads and all, with no reader in sight.
 *
 * So none of the four are re-exported. Entries reach a reader only through
 * `readCatalog` / `listCatalogsFor`, which decide a tier first, and stored data
 * is interpreted through `getCatalogVocabulary` / `listCatalogVocabularies`,
 * which are unfiltered by component state precisely because they carry no
 * payload to disclose.
 */

export {
  closeCatalogRegistration,
  defineCatalog,
  getCatalogVersion,
  hasCatalog,
  isCatalogRegistrationClosed,
  registerCatalog,
  resetCatalogRegistry,
} from "./registry";

export {
  allCatalogPermissionNames,
  catalogPermissionNames,
  getCatalogVocabulary,
  listCatalogsFor,
  listCatalogVocabularies,
  readCatalog,
  readCatalogDeclaration,
} from "./read";
