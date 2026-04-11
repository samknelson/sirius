import { pgTable, varchar, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const bulkMediumEnum = pgEnum("bulk_medium", ["sms", "email", "inapp"]);

export const bulkMessageStatusEnum = pgEnum("bulk_message_status", ["draft", "queued", "sent"]);

export const bulkMessages = pgTable("bulk_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  medium: bulkMediumEnum("medium").notNull(),
  name: varchar("name").notNull(),
  status: bulkMessageStatusEnum("status").notNull().default("draft"),
  sendDate: timestamp("send_date"),
  data: jsonb("data"),
});

export const insertBulkMessageSchema = createInsertSchema(bulkMessages).omit({
  id: true,
});

export type BulkMessage = typeof bulkMessages.$inferSelect;
export type InsertBulkMessage = z.infer<typeof insertBulkMessageSchema>;
