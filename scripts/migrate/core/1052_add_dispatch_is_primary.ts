import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Add `is_primary` boolean (NOT NULL, default false) to `dispatches`, plus a
 * partial unique index enforcing that a worker can have at most ONE accepted
 * primary dispatch at a time. Existing rows default to false; nothing is
 * backfilled as primary.
 */
async function up(): Promise<void> {
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
  version: 1052,
  name: "add_dispatch_is_primary",
  description:
    "Add dispatches.is_primary boolean (not null, default false) and partial unique index dispatches_one_primary_accepted_per_worker on (worker_id) WHERE status = 'accepted' AND is_primary = true",
  up,
};

registerMigration(migration);
