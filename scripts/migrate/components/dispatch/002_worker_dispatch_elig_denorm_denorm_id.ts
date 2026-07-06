import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "dispatch";

/**
 * Ensure `worker_dispatch_elig_denorm` carries the `denorm_id` FK to denorm(id)
 * (ON DELETE CASCADE) so the table is owned by the dispatch-eligibility denorm
 * plugins. Every eligibility fact row references its workflow status row in
 * `denorm`, so when a plugin's config — and thus its `denorm` rows — go away
 * (e.g. the component is disabled), the dependent eligibility rows cascade too.
 *
 * Owned by the `dispatch` component. On a fresh enable the schema-push already
 * creates the table WITH `denorm_id` and its index (both are in the dispatch
 * schema module), so every statement below is a no-op. On a deployment that was
 * enabled under the previous core-migration layout the column/index already
 * exist too, so this is likewise a no-op there.
 *
 * The TRUNCATE only exists to satisfy the "cannot ADD a NOT NULL column without
 * a default to a non-empty table" constraint, so it is gated on the column being
 * genuinely absent. This keeps the migration idempotent and NON-destructive when
 * it re-runs under the per-component counter on a deployment that already added
 * `denorm_id` (previously via core migration 1041): we must NOT re-purge the
 * denorm facts there, since they are only refilled by the hourly sweep.
 *
 * Idempotent: the purge is skipped whenever `denorm_id` already exists, and the
 * column / index use IF [NOT] EXISTS.
 */
async function up(): Promise<void> {
  const colRes = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'worker_dispatch_elig_denorm'
      AND column_name = 'denorm_id'
  `);
  const columnAlreadyExists = (colRes.rows ?? []).length > 0;

  // Only purge when we actually have to add the NOT NULL column to a table that
  // may hold rows. If the column is already present, re-running must not wipe the
  // denorm facts (they only repopulate on the hourly sweep).
  if (!columnAlreadyExists) {
    await db.execute(sql`TRUNCATE TABLE worker_dispatch_elig_denorm`);
  }
  await db.execute(
    sql`ALTER TABLE worker_dispatch_elig_denorm ADD COLUMN IF NOT EXISTS denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_worker_dispatch_elig_denorm_denorm ON worker_dispatch_elig_denorm (denorm_id)`,
  );
  logger.info("Ensured worker_dispatch_elig_denorm.denorm_id column + index", {
    service: "migration-dispatch-002",
    purged: !columnAlreadyExists,
  });
}

const migration: Migration = {
  version: 2,
  name: "worker_dispatch_elig_denorm_denorm_id",
  description:
    "Purge worker_dispatch_elig_denorm and ensure a NOT NULL denorm_id FK to denorm(id) ON DELETE CASCADE (plus a supporting index), so the table is maintained by the dispatch-eligibility denorm plugins and lazily repopulated by the denorm sweep.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
