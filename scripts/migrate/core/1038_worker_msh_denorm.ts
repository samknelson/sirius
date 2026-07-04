import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Worker member-status denorm payload table (worker_msh_denorm) + drop of the
 * legacy `workers.denorm_ms_ids` array column.
 *
 * The current member statuses of a worker now live in their own table, one row
 * per (worker, member-status), maintained by the `worker_ms` denorm plugin.
 * Each row references its workflow status row in `denorm` (ON DELETE CASCADE)
 * and the owning worker / member-status option (both ON DELETE CASCADE).
 * Unique on (worker_id, ms_id); secondary index on denorm_id.
 *
 * Also removes the orphaned `worker_employment` denorm plugin config (the
 * Task #482 stub kind member) which has been replaced by `worker_ms`.
 *
 * Idempotent: the table, indexes, column drop, and config delete each use
 * IF [NOT] EXISTS / no-op semantics so the migration self-heals if a previous
 * run crashed partway (migrations are not wrapped in a single transaction).
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS worker_msh_denorm (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
      worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      ms_id varchar NOT NULL REFERENCES options_worker_ms(id) ON DELETE CASCADE
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS worker_msh_denorm_worker_ms_uniq ON worker_msh_denorm (worker_id, ms_id)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS worker_msh_denorm_denorm_idx ON worker_msh_denorm (denorm_id)`,
  );
  logger.info("Ensured worker_msh_denorm table and indexes", {
    service: "migration-1038",
  });

  await db.execute(sql`ALTER TABLE workers DROP COLUMN IF EXISTS denorm_ms_ids`);

  // The Task #482 stub registered a `worker_employment` denorm plugin, which is
  // superseded by `worker_ms`. Remove its orphaned singleton config (and any
  // denorm rows, via the config FK cascade) so it does not linger in admin.
  await db.execute(sql`
    DELETE FROM plugin_configs
    WHERE plugin_kind = 'denorm' AND plugin_id = 'worker_employment'
  `);
}

const migration: Migration = {
  version: 1038,
  name: "worker_msh_denorm",
  description:
    "Create the worker_msh_denorm payload table (one row per worker+member-status, FK to denorm/workers/options_worker_ms, unique on worker_id+ms_id, index on denorm_id), drop the legacy workers.denorm_ms_ids array column, and remove the superseded worker_employment denorm plugin config.",
  up,
};

registerMigration(migration);

export default migration;
