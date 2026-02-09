import { pgTable, varchar, date, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../schema";

export const workerDispatchEba = pgTable("worker_dispatch_eba", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  date: date("date").notNull(),
  data: jsonb("data"),
}, (table) => [
  unique("worker_dispatch_eba_worker_date_unique").on(table.workerId, table.date),
]);

export const insertWorkerDispatchEbaSchema = createInsertSchema(workerDispatchEba).omit({
  id: true,
});

export type InsertWorkerDispatchEba = z.infer<typeof insertWorkerDispatchEbaSchema>;
export type WorkerDispatchEba = typeof workerDispatchEba.$inferSelect;
