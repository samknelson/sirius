import { sql } from "drizzle-orm";
import { pgTable, varchar, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "../../../../shared/schema";

// Dates and actors belong to entity_metadata, maintained by storage logging.
export const bookmarks = pgTable("bookmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
});

export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({ id: true });
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
