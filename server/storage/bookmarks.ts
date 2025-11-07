import { db } from "../db";
import { bookmarks, type Bookmark, type InsertBookmark } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface BookmarkStorage {
  getUserBookmarks(userId: string): Promise<Bookmark[]>;
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
