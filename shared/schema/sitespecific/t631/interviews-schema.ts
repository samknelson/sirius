import { pgTable, pgEnum, varchar, jsonb, unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";
import { dispatchJobs } from "../../dispatch/schema";

/**
 * Job interviews (sitespecific.t631.interviews component-owned table).
 *
 * Tracks a worker's interview lifecycle for a dispatch job. One interview
 * per [job, worker] pair, enforced by a named unique constraint.
 */
export const sitespecificT631JobInterviewStatus = pgEnum(
  "sitespecific_t631_job_interview_status",
  ["offered", "accepted", "declined", "passed", "failed"],
);

export const sitespecificT631JobInterviews = pgTable("sitespecific_t631_job_interviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  jobId: varchar("job_id").notNull().references(() => dispatchJobs.id, { onDelete: 'cascade' }),
  status: sitespecificT631JobInterviewStatus("status").notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("st631_job_interviews_job_worker_unique").on(table.jobId, table.workerId),
  index("idx_st631_job_interviews_worker_id").on(table.workerId),
]);

export const insertSitespecificT631JobInterviewSchema = createInsertSchema(sitespecificT631JobInterviews).omit({
  id: true,
});

export type InsertSitespecificT631JobInterview = z.infer<typeof insertSitespecificT631JobInterviewSchema>;
export type SitespecificT631JobInterview = typeof sitespecificT631JobInterviews.$inferSelect;
