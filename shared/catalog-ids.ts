/**
 * Catalog ids that both sides name.
 *
 * A catalog id is normally a server-side fact: the declaration names it, the
 * generic `/api/catalogs` routes address it from the URL, and the browser only
 * ever sees it as a route parameter on the catalog browser. Those ids stay in
 * their declaration files.
 *
 * An id lands here when a specific screen reads a specific catalog and so has
 * to spell the id out too. Written once, in a file both halves can import,
 * because the alternative is a string literal on each side and a silent empty
 * screen the day one of them changes.
 */

/** The configurable dropdown lists. Declared in server/storage/unified-options-catalog.ts. */
export const OPTIONS_LISTS_CATALOG = "options-lists";

/** The renameable terms. Declared in server/modules/terminology-catalog.ts. */
export const TERMINOLOGY_CATALOG = "terminology";
