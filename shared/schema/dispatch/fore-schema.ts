import { pgTable, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../schema";
import { dispatchJobs } from "./schema";

/**
 * Forepersons designated on a dispatch job (dispatch.fore component-owned
 * table). A worker can be a foreperson on many jobs, but only once per job
 * (named unique constraint on job_id + worker_id).
 *
 * There is deliberately NO automatic cleanup: a foreperson whose dispatch
 * later ends stays a foreperson — that is not a data error. Eligibility
 * (accepted primary dispatch at the job's employer) is enforced at the
 * route level, not here.
 */
export const dispatchJobFore = pgTable("dispatch_job_fore", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => dispatchJobs.id, { onDelete: 'cascade' }),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => [
  unique("dispatch_job_fore_job_id_worker_id_unique").on(table.jobId, table.workerId),
]);

export const insertDispatchJobForeSchema = createInsertSchema(dispatchJobFore).omit({
  id: true,
});

export type InsertDispatchJobFore = z.infer<typeof insertDispatchJobForeSchema>;
export type DispatchJobFore = typeof dispatchJobFore.$inferSelect;
