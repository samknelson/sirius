import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Worker work-status denorm payload table (worker_wsh_denorm) + drop of the
 * legacy `workers.denorm_ws_id` column.
 *
 * A worker has exactly ONE current work status, so the current status now lives
 * in its own table with at most one row per worker, maintained by the
 * `worker_ws` denorm plugin. The row references its workflow status row in
 * `denorm` (ON DELETE CASCADE) and the owning worker / work-status option (both
 * ON DELETE CASCADE). Unique on (worker_id); secondary index on denorm_id.
 *
 * No data migration: the old column value is discarded. On boot the plugin
 * re-queues every worker as stale and the recompute sweep refills the table
 * from work-status history (`worker_wsh`).
 *
 * Idempotent: the table, indexes, and column drop each use IF [NOT] EXISTS /
 * no-op semantics so the migration self-heals if a previous run crashed partway
 * (migrations are not wrapped in a single transaction).
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS worker_wsh_denorm (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
      worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      ws_id varchar NOT NULL REFERENCES options_worker_ws(id) ON DELETE CASCADE
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS worker_wsh_denorm_worker_uniq ON worker_wsh_denorm (worker_id)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS worker_wsh_denorm_denorm_idx ON worker_wsh_denorm (denorm_id)`,
  );
  logger.info("Ensured worker_wsh_denorm table and indexes", {
    service: "migration-1039",
  });

  await db.execute(sql`ALTER TABLE workers DROP COLUMN IF EXISTS denorm_ws_id`);
}

const migration: Migration = {
  version: 1039,
  name: "worker_wsh_denorm",
  description:
    "Create the worker_wsh_denorm payload table (at most one row per worker, FK to denorm/workers/options_worker_ws, unique on worker_id, index on denorm_id) and drop the legacy workers.denorm_ws_id column.",
  up,
};

registerMigration(migration);

export default migration;
