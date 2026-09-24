import { pgTable, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { events, denorm } from "../../schema";
import { dispatchJobs } from "./schema";

/**
 * Link row between a bullpen-host dispatch job and the event auto-created for
 * it (dispatch.bullpen component-owned table). Maintained by the
 * `dispatch_job_event` denorm plugin: at most one event per job (named unique
 * constraint on job_id). Deleting the job cascades the link row (the event
 * itself is deliberately left in place); deleting the plugin's denorm status
 * row (widow sweep) cascades it too via denorm_id.
 */
export const dispatchJobEvent = pgTable("dispatch_job_event", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  denormId: varchar("denorm_id").notNull().references(() => denorm.id, { onDelete: 'cascade' }),
  jobId: varchar("job_id").notNull().references(() => dispatchJobs.id, { onDelete: 'cascade' }),
  eventId: varchar("event_id").notNull().references(() => events.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => [
  unique("dispatch_job_event_job_id_unique").on(table.jobId),
]);

export const insertDispatchJobEventSchema = createInsertSchema(dispatchJobEvent).omit({
  id: true,
});

export type InsertDispatchJobEvent = z.infer<typeof insertDispatchJobEventSchema>;
export type DispatchJobEvent = typeof dispatchJobEvent.$inferSelect;
