import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Add `denorm_id` to `worker_dispatch_elig_denorm` so the table is owned by the
 * dispatch-eligibility denorm plugins (each eligibility concept is now a denorm
 * plugin maintained through the shared framework). Every eligibility fact row
 * references its workflow status row in `denorm` (ON DELETE CASCADE), so when a
 * plugin's config — and thus its `denorm` rows — go away (e.g. a component is
 * disabled), the dependent eligibility rows cascade away too.
 *
 * No data migration: the table is purged and lazily repopulated by the denorm
 * event handlers plus the hourly denorm backfill/stale sweep. Purging first
 * also lets us add the `NOT NULL` column on a guaranteed-empty table.
 *
 * Idempotent: TRUNCATE is a no-op on an already-empty table, and the column /
 * index use IF [NOT] EXISTS so the migration self-heals if a previous run
 * crashed partway (migrations are not wrapped in a single transaction). A
 * re-run after partial repopulation re-empties the table, which the sweep then
 * refills — consistent with the purge + lazy-repopulate design.
 */
async function up(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE worker_dispatch_elig_denorm`);
  await db.execute(
    sql`ALTER TABLE worker_dispatch_elig_denorm ADD COLUMN IF NOT EXISTS denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_worker_dispatch_elig_denorm_denorm ON worker_dispatch_elig_denorm (denorm_id)`,
  );
  logger.info("Purged worker_dispatch_elig_denorm and added denorm_id column + index", {
    service: "migration-1041",
  });
}

const migration: Migration = {
  version: 1041,
  name: "worker_dispatch_elig_denorm_denorm_id",
  description:
    "Purge worker_dispatch_elig_denorm and add a NOT NULL denorm_id FK to denorm(id) ON DELETE CASCADE (plus a supporting index), so the table is maintained by the dispatch-eligibility denorm plugins and lazily repopulated by the denorm sweep.",
  up,
};

registerMigration(migration);

export default migration;
