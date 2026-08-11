import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Permanent worker_id index on worker_hours.
 *
 * `upsertWorkerHours` calls `deriveHomeEmployerId` (WHERE worker_id = ...)
 * twice per row, and the only unique index on worker_hours leads with
 * `year` — so every call seq-scanned the growing table. During the
 * production-scale S1 hours load this decayed throughput from ~12 to
 * ~8 rows/sec (measured on the target DB: 6.4M seq scans, 1.34T tuples
 * read). The fix was applied live there on 2026-08-10 with
 * `CREATE INDEX CONCURRENTLY worker_hours_worker_id_idx`; this migration
 * makes the index permanent so every other database (dev, fresh
 * environments) gets it too.
 *
 * Plain CREATE INDEX (not CONCURRENTLY) on purpose: the migration runner
 * is non-transactional so CONCURRENTLY would technically run, but a failed
 * CONCURRENTLY build leaves an INVALID index behind. On fresh databases the
 * table is empty (instant build), and on the one large database the index
 * already exists, so IF NOT EXISTS makes this a clean no-op.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS worker_hours_worker_id_idx
      ON worker_hours (worker_id)
  `);

  logger.info("Ensured worker_hours_worker_id_idx ON worker_hours (worker_id)", {
    service: "migration-1121",
  });
}

const migration: Migration = {
  version: 1121,
  name: "worker_hours_worker_id_index",
  description:
    "Create worker_hours_worker_id_idx ON worker_hours (worker_id) so deriveHomeEmployerId stops seq-scanning; IF NOT EXISTS no-op where the index was already created live.",
  up,
};

registerMigration(migration);

export default migration;
