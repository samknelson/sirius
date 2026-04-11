import { pgTable, varchar, text, timestamp, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const bulkMediumEnum = pgEnum("bulk_medium", ["sms", "email", "inapp", "postal"]);

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

export const bulkMessagesEmail = pgTable("bulk_messages_email", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bulkId: varchar("bulk_id").notNull().references(() => bulkMessages.id, { onDelete: "cascade" }),
  fromAddress: text("from_address"),
  fromName: varchar("from_name"),
  replyTo: text("reply_to"),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  data: jsonb("data"),
});

export const insertBulkMessagesEmailSchema = createInsertSchema(bulkMessagesEmail).omit({
  id: true,
});

export type BulkMessagesEmail = typeof bulkMessagesEmail.$inferSelect;
export type InsertBulkMessagesEmail = z.infer<typeof insertBulkMessagesEmailSchema>;

export const bulkMessagesSms = pgTable("bulk_messages_sms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bulkId: varchar("bulk_id").notNull().references(() => bulkMessages.id, { onDelete: "cascade" }),
  body: text("body"),
  data: jsonb("data"),
});

export const insertBulkMessagesSmsSchema = createInsertSchema(bulkMessagesSms).omit({
  id: true,
});

export type BulkMessagesSms = typeof bulkMessagesSms.$inferSelect;
export type InsertBulkMessagesSms = z.infer<typeof insertBulkMessagesSmsSchema>;

export const bulkMessagesPostal = pgTable("bulk_messages_postal", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bulkId: varchar("bulk_id").notNull().references(() => bulkMessages.id, { onDelete: "cascade" }),
  fromName: varchar("from_name"),
  fromCompany: varchar("from_company"),
  fromAddressLine1: text("from_address_line1"),
  fromAddressLine2: text("from_address_line2"),
  fromCity: text("from_city"),
  fromState: text("from_state"),
  fromZip: text("from_zip"),
  fromCountry: text("from_country").default("US"),
  description: text("description"),
  fileUrl: text("file_url"),
  templateId: varchar("template_id"),
  mergeVariables: jsonb("merge_variables"),
  color: boolean("color").default(false).notNull(),
  doubleSided: boolean("double_sided").default(false).notNull(),
  mailType: varchar("mail_type").default("usps_first_class").notNull(),
  data: jsonb("data"),
});

export const insertBulkMessagesPostalSchema = createInsertSchema(bulkMessagesPostal).omit({
  id: true,
});

export type BulkMessagesPostal = typeof bulkMessagesPostal.$inferSelect;
export type InsertBulkMessagesPostal = z.infer<typeof insertBulkMessagesPostalSchema>;

export const bulkMessagesInapp = pgTable("bulk_messages_inapp", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bulkId: varchar("bulk_id").notNull().references(() => bulkMessages.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 100 }),
  body: varchar("body", { length: 500 }),
  linkUrl: varchar("link_url", { length: 2048 }),
  linkLabel: varchar("link_label", { length: 50 }),
  data: jsonb("data"),
});

export const insertBulkMessagesInappSchema = createInsertSchema(bulkMessagesInapp).omit({
  id: true,
});

export type BulkMessagesInapp = typeof bulkMessagesInapp.$inferSelect;
export type InsertBulkMessagesInapp = z.infer<typeof insertBulkMessagesInappSchema>;
