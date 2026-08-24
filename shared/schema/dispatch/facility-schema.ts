import { pgTable, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { facilities } from "../facility/schema";
import { dispatchJobs } from "./schema";

/**
 * Facility linked to a dispatch job (dispatch.facility component-owned
 * table). Replaces the legacy soft reference in `dispatch_jobs.data.facilityId`
 * with a real FK-backed association. The table allows multiple facilities per
 * job (named unique constraint on job_id + facility_id), but the UI keeps a
 * single-select — at most one link per job today.
 */
export const dispatchJobFacility = pgTable("dispatch_job_facility", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => dispatchJobs.id, { onDelete: 'cascade' }),
  facilityId: varchar("facility_id").notNull().references(() => facilities.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => [
  unique("dispatch_job_facility_job_id_facility_id_unique").on(table.jobId, table.facilityId),
]);

export const insertDispatchJobFacilitySchema = createInsertSchema(dispatchJobFacility).omit({
  id: true,
});

export type InsertDispatchJobFacility = z.infer<typeof insertDispatchJobFacilitySchema>;
export type DispatchJobFacility = typeof dispatchJobFacility.$inferSelect;
