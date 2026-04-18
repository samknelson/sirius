import { pgTable, varchar, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

export const workerTos = pgTable("worker_tos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  siriusId: varchar("sirius_id", { length: 255 }).unique(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  description: text("description"),
  data: jsonb("data"),
}, (table) => ({
  oneActivePerWorker: uniqueIndex("worker_tos_one_active_per_worker_idx")
    .on(table.workerId)
    .where(sql`${table.endDate} IS NULL`),
}));

export const insertWorkerTosSchema = createInsertSchema(workerTos).omit({
  id: true,
});

export type WorkerTos = typeof workerTos.$inferSelect;
export type InsertWorkerTos = z.infer<typeof insertWorkerTosSchema>;
