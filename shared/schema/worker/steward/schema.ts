import { foreignKey, pgTable, varchar, jsonb, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers, bargainingUnits } from "../../../schema";

export const workerStewardAssignments = pgTable("worker_steward_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  bargainingUnitId: varchar("bargaining_unit_id").notNull(),
  data: jsonb("data"),
}, (table) => ({
  // Explicit name, on purpose: the auto-generated name
  // "worker_steward_assignments_worker_id_employer_id_bargaining_unit_id_unique"
  // exceeds Postgres's 63-char identifier limit, so the live DB stores it
  // truncated. drizzle-kit push compares by full (untruncated) name and
  // false-positives an "add constraint" on every db-push preview run unless
  // the declared name matches what Postgres actually kept.
  uniqueWorkerEmployerBargainingUnit: unique("worker_steward_assignments_worker_id_employer_id_bargaining_uni").on(table.workerId, table.employerId, table.bargainingUnitId),
  fkBargainingUnitId: foreignKey({
    name: "worker_steward_assignments_bargaining_unit_id_bargaining_units_",
    columns: [table.bargainingUnitId],
    foreignColumns: [bargainingUnits.id],
  }).onDelete("cascade"),
}));

export const insertWorkerStewardAssignmentSchema = createInsertSchema(workerStewardAssignments).omit({
  id: true,
});

export type WorkerStewardAssignment = typeof workerStewardAssignments.$inferSelect;
export type InsertWorkerStewardAssignment = z.infer<typeof insertWorkerStewardAssignmentSchema>;
