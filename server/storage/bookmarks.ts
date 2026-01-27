import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { bookmarks, workers, employers, contacts, type Bookmark, type InsertBookmark } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertBookmark, Bookmark>();

export interface EnrichedBookmark extends Bookmark {
  displayName: string;
}

export interface BookmarkStorage {
  getUserBookmarks(userId: string): Promise<Bookmark[]>;
  getEnrichedUserBookmarks(userId: string): Promise<EnrichedBookmark[]>;
  getBookmark(id: string): Promise<Bookmark | undefined>;
  findBookmark(userId: string, entityType: string, entityId: string): Promise<Bookmark | undefined>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(id: string): Promise<boolean>;
}

export function createBookmarkStorage(): BookmarkStorage {
  return {
    async getUserBookmarks(userId: string): Promise<Bookmark[]> {
      const client = getClient();
      return client.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.createdAt));
    },

    async getEnrichedUserBookmarks(userId: string): Promise<EnrichedBookmark[]> {
      const client = getClient();
      const userBookmarks = await client.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.createdAt));
      
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
