import { pgTable, varchar, date, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers } from "../../schema";

export const workerDispatchHfe = pgTable("worker_dispatch_hfe", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  holdUntil: date("hold_until").notNull(),
}, (table) => [
  unique("worker_dispatch_hfe_worker_employer_unique").on(table.workerId, table.employerId),
]);

export const insertWorkerDispatchHfeSchema = createInsertSchema(workerDispatchHfe).omit({
  id: true,
}).extend({
  holdUntil: z.string().min(1, "Hold until date is required").refine((val) => {
    const date = new Date(val);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date > today;
  }, { message: "Hold until date must be in the future" }),
});

export type InsertWorkerDispatchHfe = z.infer<typeof insertWorkerDispatchHfeSchema>;
export type WorkerDispatchHfe = typeof workerDispatchHfe.$inferSelect;
