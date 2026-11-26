import { withStorageLogging } from "../../../server/storage/middleware/logging";
import { createBookmarkStorage, bookmarkLoggingConfig } from "./storage/bookmarks";

export function createStorage() {
  return { bookmarks: withStorageLogging(createBookmarkStorage(), bookmarkLoggingConfig) };
}
