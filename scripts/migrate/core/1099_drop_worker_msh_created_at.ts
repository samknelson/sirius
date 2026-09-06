import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1099";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `);
  const value = result.rows[0]?.exists;
  return value === true || value === "t";
}

/**
 * Retire `worker_msh.created_at`. Its history moved into `entity_metadata` in
 * migration 1098.
 *
 * Nothing decided anything with this column. It appeared as a tie-break in the
 * "latest member status" orderings (`date DESC, created_at DESC, id DESC`),
 * but `worker_msh` carries a unique (worker_id, industry_id, date) constraint,
 * so two entries for one worker and industry can never share a date and the
 * tie-break could never fire. Those clauses are removed with the column.
 *
 * `worker_wsh.created_at` is NOT dropped: that table has no such constraint,
 * so its identical tie-break is live — it decides which of two same-date work
 * statuses is the worker's current one, which drives the work-status denorm
 * and dispatch eligibility. `docs/provenance-columns.md` records it as a
 * keeper with that reason.
 *
 * Idempotent.
 */
async function up(): Promise<void> {
  if (!(await columnExists("worker_msh", "created_at"))) {
    logger.info("worker_msh.created_at already gone, nothing to drop", { service: SERVICE });
    return;
  }

  await db.execute(sql`ALTER TABLE worker_msh DROP COLUMN created_at`);
  logger.info("Dropped worker_msh.created_at", { service: SERVICE });
}

const migration: Migration = {
  version: 1099,
  name: "drop_worker_msh_created_at",
  description:
    "Drop worker_msh.created_at now that its entry dates live in entity_metadata (migration 1098); the column's only reads were tie-breaks that the table's unique (worker_id, industry_id, date) constraint made unreachable. worker_wsh.created_at stays — that table has no such constraint, so its tie-break decides which same-date work status is current.",
  up,
};

registerMigration(migration);

export default migration;
