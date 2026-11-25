import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";

export const metadataContexts: Record<string, MetadataRecordContext> = {};
// Declarative, so it holds even while the history hook is disabled.
export const excludedTables = ["session_history"] as const;
