import { pgTable, varchar, date, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const edlsSheets = pgTable("edls_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  date: date("date").notNull(),
  workerCount: integer("worker_count").notNull().default(0),
});

export const insertEdlsSheetsSchema = createInsertSchema(edlsSheets).omit({
  id: true,
});

export type EdlsSheet = typeof edlsSheets.$inferSelect;
export type InsertEdlsSheet = z.infer<typeof insertEdlsSheetsSchema>;
