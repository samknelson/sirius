import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

/**
 * Make grievances.sirius_id NOT NULL.
 *
 * Every grievance should always carry an ID: on create the app already
 * auto-generates one when none is supplied, so a nullable column no longer
 * reflects reality. Any legacy rows with a NULL/empty sirius_id (test data
 * only) are backfilled with a distinct random UUID string first so the
 * NOT NULL constraint — and the startup drift gate — can be satisfied.
 *
 * Idempotent: the backfill only touches NULL/empty rows, and SET NOT NULL is
 * a no-op if the column is already NOT NULL, so a re-run is safe.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    UPDATE grievances
    SET sirius_id = gen_random_uuid()::text
    WHERE sirius_id IS NULL OR sirius_id = ''
  `);
  logger.info("Backfilled NULL/empty grievances.sirius_id with random UUIDs", {
    service: "migration-grievance-025",
  });

  await db.execute(sql`
    ALTER TABLE grievances
    ALTER COLUMN sirius_id SET NOT NULL
  `);
  logger.info("Set grievances.sirius_id NOT NULL", {
    service: "migration-grievance-025",
  });
}

const migration: Migration = {
  version: 25,
  name: "make_grievance_sirius_id_not_null",
  description:
    "Backfill NULL/empty grievances.sirius_id with random UUIDs, then set the column NOT NULL. Idempotent: backfill only affects empty rows and SET NOT NULL is a no-op when already applied.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
