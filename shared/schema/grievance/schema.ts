import { pgTable, varchar, text, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers } from "../../schema";

export const optionsGrievanceStatus = pgTable("options_grievance_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  data: jsonb("data"),
});

export const insertOptionsGrievanceStatusSchema = createInsertSchema(
  optionsGrievanceStatus,
).omit({
  id: true,
});

export type OptionsGrievanceStatus = typeof optionsGrievanceStatus.$inferSelect;
export type InsertOptionsGrievanceStatus = z.infer<
  typeof insertOptionsGrievanceStatusSchema
>;

export const optionsGrievanceCategory = pgTable("options_grievance_category", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  data: jsonb("data"),
});

export const insertOptionsGrievanceCategorySchema = createInsertSchema(
  optionsGrievanceCategory,
).omit({
  id: true,
});

export type OptionsGrievanceCategory = typeof optionsGrievanceCategory.$inferSelect;
export type InsertOptionsGrievanceCategory = z.infer<
  typeof insertOptionsGrievanceCategorySchema
>;

export const GRIEVANCE_CARDINALITIES = [
  "individual",
  "multiple",
  "multiple-with-lead",
  "class",
] as const;

export type GrievanceCardinality = (typeof GRIEVANCE_CARDINALITIES)[number];

export const grievances = pgTable("grievances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  complaint: text("complaint"),
  remedy: text("remedy"),
  classDescription: text("class_description"),
  cardinality: varchar("cardinality").notNull().default("individual"),
  statusId: varchar("status_id")
    .notNull()
    .references(() => optionsGrievanceStatus.id, { onDelete: "restrict" }),
  categoryId: varchar("category_id")
    .notNull()
    .references(() => optionsGrievanceCategory.id, { onDelete: "restrict" }),
  data: jsonb("data"),
});

export const insertGrievanceSchema = createInsertSchema(grievances).omit({
  id: true,
});

export type Grievance = typeof grievances.$inferSelect;
export type InsertGrievance = z.infer<typeof insertGrievanceSchema>;

export const grievanceWorkers = pgTable(
  "grievance_workers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workerId: varchar("worker_id")
      .notNull()
      .references(() => workers.id, { onDelete: "restrict" }),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "restrict" }),
    primary: boolean("primary").notNull().default(true),
    data: jsonb("data"),
  },
  (table) => ({
    workerGrievanceUnique: uniqueIndex("grievance_workers_worker_grievance_unique").on(
      table.workerId,
      table.grievanceId,
    ),
    onePrimaryPerGrievance: uniqueIndex("grievance_workers_one_primary_per_grievance")
      .on(table.grievanceId)
      // `primary` is a reserved word; Postgres reflects the partial-index
      // predicate with the identifier quoted (`"primary" = true`). The drift
      // gate compares predicate strings without stripping per-identifier
      // quotes, so the declared predicate must carry the quotes literally
      // rather than interpolating `${table.primary}` (which renders unquoted).
      .where(sql`"primary" = true`),
  }),
);

export const insertGrievanceWorkerSchema = createInsertSchema(grievanceWorkers).omit({
  id: true,
});

export type GrievanceWorker = typeof grievanceWorkers.$inferSelect;
export type InsertGrievanceWorker = z.infer<typeof insertGrievanceWorkerSchema>;

export const grievanceEmployers = pgTable(
  "grievance_employers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    employerId: varchar("employer_id")
      .notNull()
      .references(() => employers.id, { onDelete: "restrict" }),
    grievanceId: varchar("grievance_id")
      .notNull()
      .references(() => grievances.id, { onDelete: "restrict" }),
    data: jsonb("data"),
  },
  (table) => ({
    employerGrievanceUnique: uniqueIndex("grievance_employers_employer_grievance_unique").on(
      table.employerId,
      table.grievanceId,
    ),
  }),
);

export const insertGrievanceEmployerSchema = createInsertSchema(grievanceEmployers).omit({
  id: true,
});

export type GrievanceEmployer = typeof grievanceEmployers.$inferSelect;
export type InsertGrievanceEmployer = z.infer<typeof insertGrievanceEmployerSchema>;
