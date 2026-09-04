import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
}

/**
 * Add `is_primary` boolean (NOT NULL, default false) to `dispatches`, plus a
 * partial unique index enforcing that a worker can have at most ONE accepted
 * primary dispatch at a time. Existing rows default to false; nothing is
 * backfilled as primary.
 *
 * `dispatches` belongs to the OPTIONAL `dispatch` component's schema manifest,
 * so it is absent on any deployment that never enabled dispatch. A core
 * migration runs everywhere, and the runner stops the boot on the first
 * failure — so the table reference has to be guarded. When the component is
 * later enabled, schema-push creates the table from the current Drizzle
 * definition (which already declares this column and index), so skipping here
 * loses nothing.
 */
async function up(): Promise<void> {
  // `dispatches` is owned by the optional `dispatch` component. Core
  // migrations must tolerate optional-component tables being absent: on a
  // deployment where the component was never enabled, this migration must
  // no-op instead of failing (which would stall the shared migrations_version
  // counter and block every later core migration). The column + partial
  // unique index are both in the dispatch component's schema manifest, so
  // the component-enable flow creates them when the component is enabled.
  const tableCheck = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dispatches'
  `);
  if (tableCheck.rows.length === 0) {
    logger.info(
      "Skipping dispatches.is_primary migration — dispatches table absent (dispatch component not enabled); enable flow will create it from the schema manifest",
      { service: "migration-1112" },
    );
    return;
  }

  await db.execute(sql`
    ALTER TABLE dispatches
      ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS dispatches_one_primary_accepted_per_worker
      ON dispatches (worker_id)
      WHERE status = 'accepted' AND is_primary = true
  `);

  logger.info("Added dispatches.is_primary and one-accepted-primary-per-worker unique index", {
    service: "migration-1052",
  });
}

const migration: Migration = {
  version: 1112,
  name: "add_dispatch_is_primary",
  description:
    "Add dispatches.is_primary boolean (not null, default false) and partial unique index dispatches_one_primary_accepted_per_worker on (worker_id) WHERE status = 'accepted' AND is_primary = true",
  up,
};

registerMigration(migration);
