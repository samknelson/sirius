import { pgTable, varchar, boolean, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../schema";

export const workerDispatchAsi = pgTable("worker_dispatch_asi", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().unique().references(() => workers.id, { onDelete: 'cascade' }),
  asi: boolean("asi").notNull(),
  data: jsonb("data"),
});

export const insertWorkerDispatchAsiSchema = createInsertSchema(workerDispatchAsi).omit({
  id: true,
});

export type InsertWorkerDispatchAsi = z.infer<typeof insertWorkerDispatchAsiSchema>;
export type WorkerDispatchAsi = typeof workerDispatchAsi.$inferSelect;
