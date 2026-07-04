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
 * Add a nullable, unique `sirius_id` varchar column to the grievances table.
 * Surfaced in the UI as the "Grievance ID". Existing rows backfill to NULL
 * automatically (the field is optional and starts empty). The unique constraint
 * allows many NULLs but rejects duplicate non-null values.
 *
 * Idempotent: skips the column add if it already exists, and creates the unique
 * index with IF NOT EXISTS so a re-run is safe.
 */
async function up(): Promise<void> {
  if (!(await columnExists("grievances", "sirius_id"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD COLUMN "sirius_id" varchar
    `);
    logger.info("Added sirius_id column to grievances", {
      service: "migration-grievance-021",
    });
  } else {
    logger.info("grievances.sirius_id already exists, skipping", {
      service: "migration-grievance-021",
    });
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS grievances_sirius_id_unique
    ON grievances (sirius_id)
  `);
}

const migration: Migration = {
  version: 21,
  name: "add_sirius_id_to_grievances",
  description:
    "Add a nullable, unique sirius_id varchar column to grievances (UI label 'Grievance ID'). Existing rows backfill to NULL; the unique index allows many NULLs but rejects duplicate non-null values. Idempotent: skips the column add if present and creates the index with IF NOT EXISTS.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
