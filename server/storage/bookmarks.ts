import { db } from './db';
import { bookmarks, workers, employers, contacts, type Bookmark, type InsertBookmark } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

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
      return db.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.createdAt));
    },

    async getEnrichedUserBookmarks(userId: string): Promise<EnrichedBookmark[]> {
      const userBookmarks = await db.select().from(bookmarks).where(eq(bookmarks.userId, userId)).orderBy(desc(bookmarks.createdAt));
      
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
        const workerData = await db
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
        const employerData = await db
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
      const [bookmark] = await db.select().from(bookmarks).where(eq(bookmarks.id, id));
      return bookmark || undefined;
    },

    async findBookmark(userId: string, entityType: string, entityId: string): Promise<Bookmark | undefined> {
      const [bookmark] = await db
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
      const [bookmark] = await db
        .insert(bookmarks)
        .values(insertBookmark)
        .returning();
      return bookmark;
    },

    async deleteBookmark(id: string): Promise<boolean> {
      const result = await db.delete(bookmarks).where(eq(bookmarks.id, id)).returning();
      return result.length > 0;
    }
  };
}
