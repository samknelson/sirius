import { pgTable, text, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { employers, workers } from "../../schema";

export const optionsDispatchJobType = pgTable("options_dispatch_job_type", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const dispatchJobStatusEnum = ["draft", "open", "running", "closed", "archived"] as const;
export type DispatchJobStatus = typeof dispatchJobStatusEnum[number];

export const dispatchJobs = pgTable("dispatch_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  jobTypeId: varchar("job_type_id").references(() => optionsDispatchJobType.id, { onDelete: 'set null' }),
  title: text("title").notNull(),
  description: text("description"),
  status: varchar("status").notNull().default("draft"),
  startDate: timestamp("start_date").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const insertDispatchJobTypeSchema = createInsertSchema(optionsDispatchJobType).omit({
  id: true,
});

export const insertDispatchJobSchema = createInsertSchema(dispatchJobs).omit({
  id: true,
  createdAt: true,
}).extend({
  startDate: z.coerce.date(),
});

export type InsertDispatchJobType = z.infer<typeof insertDispatchJobTypeSchema>;
export type DispatchJobType = typeof optionsDispatchJobType.$inferSelect;

export type InsertDispatchJob = z.infer<typeof insertDispatchJobSchema>;
export type DispatchJob = typeof dispatchJobs.$inferSelect;

// Dispatches (worker assignments to jobs)
export const dispatchStatusEnum = [
  "pending", 
  "notified", 
  "accepted_primary", 
  "accepted_secondary", 
  "layoff", 
  "resigned", 
  "declined"
] as const;
export type DispatchStatus = typeof dispatchStatusEnum[number];

export const dispatches = pgTable("dispatches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => dispatchJobs.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  status: varchar("status").notNull().default("pending"),
  data: jsonb("data"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
});

export const insertDispatchSchema = createInsertSchema(dispatches).omit({
  id: true,
}).extend({
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
});

export type InsertDispatch = z.infer<typeof insertDispatchSchema>;
export type Dispatch = typeof dispatches.$inferSelect;

// Worker dispatch status (availability for dispatch)
export const workerDispatchStatusEnum = ["available", "not_available"] as const;
export type WorkerDispatchStatusOption = typeof workerDispatchStatusEnum[number];

export const workerDispatchStatus = pgTable("worker_dispatch_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().unique().references(() => workers.id, { onDelete: 'cascade' }),
  status: varchar("status").notNull().default("available"),
  seniorityDate: timestamp("seniority_date"),
});

export const insertWorkerDispatchStatusSchema = createInsertSchema(workerDispatchStatus).omit({
  id: true,
}).extend({
  status: z.enum(workerDispatchStatusEnum).default("available"),
  seniorityDate: z.coerce.date().optional().nullable(),
});

export type InsertWorkerDispatchStatus = z.infer<typeof insertWorkerDispatchStatusSchema>;
export type WorkerDispatchStatus = typeof workerDispatchStatus.$inferSelect;
