import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Worker employment denorm payload table (worker_employment_denorm) + drop of
 * the legacy `workers.denorm_home_employer_id`, `workers.denorm_employer_ids`,
 * and `workers.denorm_job_title` columns.
 *
 * A worker's current employment now lives in its own table with one row per
 * (worker, employer), maintained by the `worker_employment` denorm plugin.
 * At most one row per worker carries `home = true` (a worker may have no home
 * employer), and `job_title` is stored on every row. Each row references its
 * workflow status row in `denorm`
 * (ON DELETE CASCADE) and the owning worker / employer (both ON DELETE CASCADE).
 * Unique on (worker_id, employer_id); secondary index on denorm_id.
 *
 * No data migration: the old column values are discarded. On boot the plugin
 * re-queues every worker as stale and the recompute sweep refills the table from
 * hours history (`worker_hours`).
 *
 * Idempotent: the table, indexes, and column drops each use IF [NOT] EXISTS /
 * no-op semantics so the migration self-heals if a previous run crashed partway
 * (migrations are not wrapped in a single transaction).
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS worker_employment_denorm (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
      worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      employer_id varchar NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
      home boolean NOT NULL DEFAULT false,
      job_title text
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS worker_employment_denorm_worker_employer_uniq ON worker_employment_denorm (worker_id, employer_id)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS worker_employment_denorm_denorm_idx ON worker_employment_denorm (denorm_id)`,
  );
  logger.info("Ensured worker_employment_denorm table and indexes", {
    service: "migration-1040",
  });

  await db.execute(sql`ALTER TABLE workers DROP COLUMN IF EXISTS denorm_home_employer_id`);
  await db.execute(sql`ALTER TABLE workers DROP COLUMN IF EXISTS denorm_employer_ids`);
  await db.execute(sql`ALTER TABLE workers DROP COLUMN IF EXISTS denorm_job_title`);
}

const migration: Migration = {
  version: 1040,
  name: "worker_employment_denorm",
  description:
    "Create the worker_employment_denorm payload table (one row per worker/employer, FK to denorm/workers/employers, unique on (worker_id, employer_id), index on denorm_id) and drop the legacy workers.denorm_home_employer_id, workers.denorm_employer_ids, and workers.denorm_job_title columns.",
  up,
};

registerMigration(migration);

export default migration;
