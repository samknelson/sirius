import { pgTable, text, varchar, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers } from "../../schema";

export const dispatchWorkerDncTypeEnum = ["employer", "worker"] as const;
export type DispatchWorkerDncType = typeof dispatchWorkerDncTypeEnum[number];

export const workerDispatchDnc = pgTable("worker_dispatch_dnc", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  type: varchar("type").notNull(),
  data: jsonb("data"),
  message: text("message"),
}, (table) => ({
  workerEmployerTypeUnique: sql`UNIQUE(${table.workerId}, ${table.employerId}, ${table.type})`,
}));

export const insertWorkerDispatchDncSchema = createInsertSchema(workerDispatchDnc).omit({
  id: true,
}).extend({
  type: z.enum(dispatchWorkerDncTypeEnum),
});

export type InsertWorkerDispatchDnc = z.infer<typeof insertWorkerDispatchDncSchema>;
export type WorkerDispatchDnc = typeof workerDispatchDnc.$inferSelect;
