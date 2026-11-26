import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { bookmarks } from "../shared/schema/bookmarks";

export const metadataContexts = {
  bookmarks: { table: bookmarks, label: "Bookmarks", hrefTemplate: null, component: "bookmark" },
} satisfies Record<string, MetadataRecordContext>;
