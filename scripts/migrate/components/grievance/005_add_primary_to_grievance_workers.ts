import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Add a `primary` boolean column to grievance_workers plus a partial unique
 * index enforcing at most one primary worker per grievance.
 *
 * Ordering matters:
 *   1. Add the column as NOT NULL DEFAULT false so any existing rows backfill
 *      to false (they would otherwise all become primary and violate the new
 *      one-primary-per-grievance constraint).
 *   2. Flip the column default to true so future inserts default to primary.
 *   3. Create the partial unique index restricted to primary rows.
 *
 * Idempotent: guards the column add and uses IF NOT EXISTS for the index, and
 * always (re)asserts the default so a partially-applied state converges.
 */
async function up(): Promise<void> {
  if (!(await columnExists("grievance_workers", "primary"))) {
    await db.execute(sql`
      ALTER TABLE grievance_workers
      ADD COLUMN "primary" boolean NOT NULL DEFAULT false
    `);
    logger.info("Added primary column to grievance_workers", {
      service: "migration-grievance-005",
    });
  } else {
    logger.info("grievance_workers.primary already exists, skipping add", {
      service: "migration-grievance-005",
    });
  }

  await db.execute(sql`
    ALTER TABLE grievance_workers
    ALTER COLUMN "primary" SET DEFAULT true
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS grievance_workers_one_primary_per_grievance
    ON grievance_workers (grievance_id)
    WHERE "primary" = true
  `);
}

const migration: Migration = {
  version: 5,
  name: "add_primary_to_grievance_workers",
  description:
    "Add a primary boolean column to grievance_workers (NOT NULL; existing rows backfilled to false, future inserts default to true) plus a partial unique index enforcing at most one primary worker per grievance. Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
