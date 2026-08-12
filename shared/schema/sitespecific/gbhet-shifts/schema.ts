import { pgTable, varchar, jsonb, integer, unique, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

export const gbhetWorkerShifts = pgTable("gbhet_worker_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  statementYmd: date("statement_ymd").notNull(),
  shiftCount: integer("shift_count").notNull().default(0),
  data: jsonb("data"),
}, (table) => [
  unique("gbhet_worker_shifts_worker_statement_unique").on(table.workerId, table.statementYmd),
]);

export const insertGbhetWorkerShiftSchema = createInsertSchema(gbhetWorkerShifts).omit({
  id: true,
});

export type GbhetWorkerShift = typeof gbhetWorkerShifts.$inferSelect;
export type InsertGbhetWorkerShift = z.infer<typeof insertGbhetWorkerShiftSchema>;
