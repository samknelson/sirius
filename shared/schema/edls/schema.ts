import { pgTable, varchar, date, integer, time, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { employers, workers, users } from "../../schema";

export const edlsSheetStatusEnum = ["draft", "request", "lock", "trash", "reserved"] as const;
export type EdlsSheetStatus = typeof edlsSheetStatusEnum[number];

export const edlsSheets = pgTable("edls_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  title: varchar("title", { length: 255 }).notNull(),
  date: date("date").notNull(),
  workerCount: integer("worker_count").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("draft"),
  supervisor: varchar("supervisor").references(() => users.id, { onDelete: 'set null' }),
  assignee: varchar("assignee").references(() => users.id, { onDelete: 'set null' }),
  data: jsonb("data"),
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
  supervisor: varchar("supervisor").references(() => users.id, { onDelete: 'set null' }),
  data: jsonb("data"),
});

export const insertEdlsCrewsSchema = createInsertSchema(edlsCrews).omit({
  id: true,
});

export type EdlsCrew = typeof edlsCrews.$inferSelect;
export type InsertEdlsCrew = z.infer<typeof insertEdlsCrewsSchema>;

export const edlsAssignments = pgTable("edls_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  crewId: varchar("crew_id").notNull().references(() => edlsCrews.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => [
  unique("edls_assignments_date_worker_id_unique").on(table.date, table.workerId),
]);

export const insertEdlsAssignmentsSchema = createInsertSchema(edlsAssignments).omit({
  id: true,
});

export type EdlsAssignment = typeof edlsAssignments.$inferSelect;
export type InsertEdlsAssignment = z.infer<typeof insertEdlsAssignmentsSchema>;
