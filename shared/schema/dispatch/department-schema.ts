import { pgTable, varchar, jsonb, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, optionsDepartment } from "../../schema";
import { dispatchJobs } from "./schema";

export const workerDispatchDepartmentPreferenceEnum = ["include", "exclude"] as const;
export type WorkerDispatchDepartmentPreference = typeof workerDispatchDepartmentPreferenceEnum[number];

/**
 * Worker department preferences (dispatch.department component-owned table).
 *
 * Each row records that a worker either wants to work ONLY in certain
 * departments ("include") or wants to avoid certain departments ("exclude").
 * A worker's rows are all-include or all-exclude, never mixed — enforced by
 * the storage layer (WorkerDispatchDepartmentModeError), not by a DB
 * constraint.
 *
 * FK names are pinned explicitly: the auto-generated
 * `worker_dispatch_department_department_id_options_department_id_fk` would
 * exceed Postgres's 63-char identifier limit.
 */
export const workerDispatchDepartment = pgTable("worker_dispatch_department", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull(),
  departmentId: varchar("department_id").notNull(),
  preference: varchar("preference").notNull(),
  data: jsonb("data"),
}, (table) => [
  foreignKey({
    name: "worker_dispatch_department_worker_id_fk",
    columns: [table.workerId],
    foreignColumns: [workers.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "worker_dispatch_department_department_id_fk",
    columns: [table.departmentId],
    foreignColumns: [optionsDepartment.id],
  }).onDelete("cascade"),
  unique("worker_dispatch_department_worker_id_department_id_unique").on(table.workerId, table.departmentId),
]);

export const insertWorkerDispatchDepartmentSchema = createInsertSchema(workerDispatchDepartment).omit({
  id: true,
}).extend({
  preference: z.enum(workerDispatchDepartmentPreferenceEnum),
});

export type InsertWorkerDispatchDepartment = z.infer<typeof insertWorkerDispatchDepartmentSchema>;
export type WorkerDispatchDepartment = typeof workerDispatchDepartment.$inferSelect;

/**
 * Department assigned to a dispatch job (dispatch.department component-owned
 * table). At most one department per job (unique on job_id). Optional — jobs
 * without a row have no department.
 */
export const dispatchJobDepartment = pgTable("dispatch_job_department", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull(),
  departmentId: varchar("department_id").notNull(),
  data: jsonb("data"),
}, (table) => [
  foreignKey({
    name: "dispatch_job_department_job_id_fk",
    columns: [table.jobId],
    foreignColumns: [dispatchJobs.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "dispatch_job_department_department_id_fk",
    columns: [table.departmentId],
    foreignColumns: [optionsDepartment.id],
  }).onDelete("cascade"),
  unique("dispatch_job_department_job_id_unique").on(table.jobId),
]);

export const insertDispatchJobDepartmentSchema = createInsertSchema(dispatchJobDepartment).omit({
  id: true,
});

export type InsertDispatchJobDepartment = z.infer<typeof insertDispatchJobDepartmentSchema>;
export type DispatchJobDepartment = typeof dispatchJobDepartment.$inferSelect;
