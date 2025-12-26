import { pgTable, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers, bargainingUnits } from "../../../schema";

export const workerStewardAssignments = pgTable("worker_steward_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  bargainingUnitId: varchar("bargaining_unit_id").notNull().references(() => bargainingUnits.id, { onDelete: 'cascade' }),
  data: jsonb("data"),
}, (table) => ({
  uniqueWorkerEmployerBargainingUnit: unique().on(table.workerId, table.employerId, table.bargainingUnitId),
}));

export const insertWorkerStewardAssignmentSchema = createInsertSchema(workerStewardAssignments).omit({
  id: true,
});

export type WorkerStewardAssignment = typeof workerStewardAssignments.$inferSelect;
export type InsertWorkerStewardAssignment = z.infer<typeof insertWorkerStewardAssignmentSchema>;
