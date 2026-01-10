import { pgTable, varchar, date, integer, time } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { employers } from "../../schema";

export const edlsSheetStatusEnum = ["draft", "request", "lock", "trash", "reserved"] as const;
export type EdlsSheetStatus = typeof edlsSheetStatusEnum[number];

export const edlsSheets = pgTable("edls_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  date: date("date").notNull(),
  workerCount: integer("worker_count").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
});

export const insertEdlsSheetsSchema = createInsertSchema(edlsSheets).omit({
  id: true,
});

export type EdlsSheet = typeof edlsSheets.$inferSelect;
export type InsertEdlsSheet = z.infer<typeof insertEdlsSheetsSchema>;

export const edlsCrews = pgTable("edls_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => edlsSheets.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  workerCount: integer("worker_count").notNull(),
  location: varchar("location", { length: 255 }),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
});

export const insertEdlsCrewsSchema = createInsertSchema(edlsCrews).omit({
  id: true,
});

export type EdlsCrew = typeof edlsCrews.$inferSelect;
export type InsertEdlsCrew = z.infer<typeof insertEdlsCrewsSchema>;
