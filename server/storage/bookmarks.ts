import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { bookmarks, entityMetadata, workers, employers, contacts, type Bookmark, type InsertBookmark } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertBookmark, Bookmark>();

/** The raw table name this module's provenance rows are filed under. */
const BOOKMARKS_TABLE = "bookmarks";

/**
 * A bookmark and when it was added.
 *
 * The table itself no longer carries that date: adding and removing a
 * bookmark is a logged mutation, so `entity_metadata` holds when it happened
 * and who did it (`docs/provenance-columns.md`). Every read of a person's
 * bookmarks resolves it here, once, so the bookmarks page and the dashboard
 * widget both get the date and the newest-first order without either doing
 * its own join.
 *
 * Null when the record has no provenance row. Provenance is best effort by
 * contract, and it is written after the creating transaction commits, so a
 * bookmark with no date is a real state a display has to survive rather than
 * an error.
 */
export interface BookmarkWithCreated extends Bookmark {
  createdDate: Date | null;
}

export interface EnrichedBookmark extends BookmarkWithCreated {
  displayName: string;
}

export interface BookmarkStorage {
  getUserBookmarks(userId: string): Promise<BookmarkWithCreated[]>;
  getEnrichedUserBookmarks(userId: string): Promise<EnrichedBookmark[]>;
  getBookmark(id: string): Promise<Bookmark | undefined>;
  findBookmark(userId: string, entityType: string, entityId: string): Promise<Bookmark | undefined>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: string): Promise<boolean>;
}

/**
 * One person's bookmarks, newest first, each with its creation date read from
 * provenance.
 *
 * The join is left: a missing provenance row must not make a bookmark
 * disappear from the list that is the only way to remove it. A descending
 * sort leaves an unstamped bookmark first, which is where it belongs — the
 * stamp is written after the insert commits, so the bookmark still waiting
 * for one is the one just added. `id` breaks ties so the order is stable
 * between calls.
 */
async function listUserBookmarks(userId: string): Promise<BookmarkWithCreated[]> {
  const client = getClient();
  const rows = await client
    .select({ bookmark: bookmarks, createdDate: entityMetadata.createdDate })
    .from(bookmarks)
    .leftJoin(
      entityMetadata,
      and(
        eq(entityMetadata.entityId, bookmarks.id),
        eq(entityMetadata.contextId, BOOKMARKS_TABLE),
      ),
    )
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(entityMetadata.createdDate), desc(bookmarks.id));

  return rows.map((row) => ({ ...row.bookmark, createdDate: row.createdDate ?? null }));
}

export function createBookmarkStorage(): BookmarkStorage {
  return {
    async getUserBookmarks(userId: string): Promise<BookmarkWithCreated[]> {
      return listUserBookmarks(userId);
    },

    async getEnrichedUserBookmarks(userId: string): Promise<EnrichedBookmark[]> {
      const client = getClient();
      const userBookmarks = await listUserBookmarks(userId);

      if (userBookmarks.length === 0) {
        return [];
      }

      const workerBookmarks = userBookmarks.filter(b => b.entityType === 'worker');
      const employerBookmarks = userBookmarks.filter(b => b.entityType === 'employer');

      const workerIds = workerBookmarks.map(b => b.entityId);
      const employerIds = employerBookmarks.map(b => b.entityId);

      const workerDisplayNames: Record<string, string> = {};
      const employerDisplayNames: Record<string, string> = {};

      if (workerIds.length > 0) {
        const workerData = await client
          .select({
            workerId: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
          })
          .from(workers)
          .innerJoin(contacts, eq(workers.contactId, contacts.id))
          .where(inArray(workers.id, workerIds));
        
        for (const w of workerData) {
          workerDisplayNames[w.workerId] = w.displayName || `Worker #${w.siriusId}`;
        }
      }

      if (employerIds.length > 0) {
        const employerData = await client
          .select({
            employerId: employers.id,
            name: employers.name,
            siriusId: employers.siriusId,
          })
          .from(employers)
          .where(inArray(employers.id, employerIds));
        
        for (const e of employerData) {
          employerDisplayNames[e.employerId] = e.name || `Employer #${e.siriusId}`;
        }
      }

      return userBookmarks.map(bookmark => {
        let displayName: string;
        
        if (bookmark.entityType === 'worker') {
          displayName = workerDisplayNames[bookmark.entityId] || `Worker #${bookmark.entityId.slice(0, 8)}`;
        } else if (bookmark.entityType === 'employer') {
          displayName = employerDisplayNames[bookmark.entityId] || `Employer #${bookmark.entityId.slice(0, 8)}`;
        } else {
          displayName = `${bookmark.entityType} #${bookmark.entityId.slice(0, 8)}`;
        }

        return {
          ...bookmark,
          displayName,
        };
      });
    },

    async getBookmark(id: string): Promise<Bookmark | undefined> {
      const client = getClient();
      const [bookmark] = await client.select().from(bookmarks).where(eq(bookmarks.id, id));
      return bookmark || undefined;
    },

    async findBookmark(userId: string, entityType: string, entityId: string): Promise<Bookmark | undefined> {
      const client = getClient();
      const [bookmark] = await client
        .select()
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            eq(bookmarks.entityType, entityType),
            eq(bookmarks.entityId, entityId)
          )
        );
      return bookmark || undefined;
    },

    async createBookmark(insertBookmark: InsertBookmark): Promise<Bookmark> {
      validate.validateOrThrow(insertBookmark);
      const client = getClient();
      const [bookmark] = await client
        .insert(bookmarks)
        .values(insertBookmark)
        .returning();
      return bookmark;
    },

    async deleteBookmark(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(bookmarks).where(eq(bookmarks.id, id)).returning();
      return result.length > 0;
    }
  };
}

interface BookmarkBeforeState {
  bookmark?: Bookmark;
}

/** How a bookmark's own record reads in a log line: `worker abc12345`. */
function describeBookmark(bookmark: Pick<Bookmark, "entityType" | "entityId"> | undefined): string {
  if (!bookmark) return "a record";
  return `${bookmark.entityType} ${bookmark.entityId}`;
}

/**
 * Bookmarks under storage logging.
 *
 * A bookmark is a record like any other, and adding or removing one is the
 * whole of its history — so the two mutations are declared as the creation
 * and the deletion of that record, which is what fills in its
 * `entity_metadata` row (the date the lists sort and display) and names the
 * person who did it.
 *
 * No `hostTable`: a bookmark belongs to a person but it is not a change to
 * their user record, and stamping `users` on every bookmark would say it was.
 */
export const bookmarkLoggingConfig = defineLoggingConfig<BookmarkStorage>({
  module: 'bookmarks',
  table: BOOKMARKS_TABLE,
  state: { key: 'bookmark' },
  getter: 'getBookmark',
  methods: {
    createBookmark: {
      metadataMode: 'created',
      getDescription: async (args, result) =>
        `Bookmarked ${describeBookmark(result ?? args[0])}`,
    },
    deleteBookmark: {
      metadataMode: 'deleted',
      getDescription: async (_args, _result, beforeState) =>
        `Removed bookmark for ${describeBookmark((beforeState as BookmarkBeforeState | undefined)?.bookmark)}`,
    },
  },
});
