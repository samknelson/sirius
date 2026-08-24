import { pgTable, varchar, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

/**
 * Worker Access Tokens (`worker.aat`).
 *
 * At most one row per worker, holding the pair of values a future
 * "reach this page by following a link" flow will use:
 *  - `accessUuid` — the generated lookup key a link would carry. Nullable
 *    but UNIQUE: two rows sharing one would make that lookup ambiguous.
 *  - `accessCode` — an editable, human-shareable code. Optional and
 *    deliberately NOT unique (two workers may pick the same code).
 *
 * The worker reference cascades on delete so removing a worker removes
 * their access-token row.
 */
export const workerAat = pgTable("worker_aat", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  accessCode: varchar("access_code"),
  accessUuid: varchar("access_uuid"),
}, (table) => ({
  workerAatWorkerIdUnique: unique("worker_aat_worker_id_unique").on(table.workerId),
  workerAatAccessUuidUnique: unique("worker_aat_access_uuid_unique").on(table.accessUuid),
}));

/**
 * Blank normalizes to NULL for both optional columns: an empty string is a
 * real value to Postgres, so a second blank `access_uuid` would collide with
 * the first under the UNIQUE constraint. The OUTER `.optional()` keeps the
 * key genuinely absent-able, so a partial update that omits a field never
 * runs the transform and never silently clears it.
 */
export const insertWorkerAatSchema = createInsertSchema(workerAat)
  .omit({ id: true })
  .extend({
    accessCode: z.string().trim().nullish().transform((v) => (v ? v : null)).optional(),
    accessUuid: z.string().trim().nullish().transform((v) => (v ? v : null)).optional(),
  });

export type WorkerAat = typeof workerAat.$inferSelect;
export type InsertWorkerAat = z.infer<typeof insertWorkerAatSchema>;
