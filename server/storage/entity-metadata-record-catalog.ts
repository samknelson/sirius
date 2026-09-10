import { registerCatalog } from "@shared/catalog";
import { listMetadataRecordContexts } from "./entity-metadata-record-tables";

/**
 * The record-history areas, as a shared catalog.
 *
 * Kept in its own file rather than added to
 * ./entity-metadata-record-tables.ts: that module is deliberately light on
 * dependencies because the startup path and a SQL-safety assertion both import
 * it, and it should not acquire a registration side effect on import.
 *
 * The declarations there carry a Drizzle table object and its physical table
 * name. Neither is projected here. A table reference is not something a client
 * has any use for, `CatalogValue` could not hold the object anyway, and the
 * existing admin endpoint has always withheld the name — so the catalog carries
 * the context id, the label, and the destination template, and nothing else.
 *
 * The eligibility rule that refuses process-family tables stays where it is:
 * `listMetadataRecordContexts()` already applies it, so an ineligible table
 * cannot reach the catalog. It is this area's own product boundary, not
 * something the catalog framework should learn about.
 */

export const RECORD_HISTORY_AREAS_CATALOG = "record-history-areas";

export function registerRecordHistoryAreasCatalog(): void {
  registerCatalog({
    id: RECORD_HISTORY_AREAS_CATALOG,
    label: "Record History Areas",
    description:
      "Record types that carry record history. Whether any history has been " +
      "recorded for one is a question for the record history screen.",
    audience: "gated",
    viewPermission: "admin",
    entries: () =>
      listMetadataRecordContexts().map(({ contextId, label, hrefTemplate }) => ({
        id: contextId,
        name: label,
        // `null` is a real answer: a good many of these areas have no page of
        // their own to link a record to.
        detail: { hrefTemplate },
      })),
  });
}
