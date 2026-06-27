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
 * Add a nullable `class_description` long-text column to the grievances table.
 *
 * The column is nullable with no default, so existing rows backfill to NULL
 * automatically when the column is added.
 *
 * Idempotent: skips if the column already exists.
 */
async function up(): Promise<void> {
  if (!(await columnExists("grievances", "class_description"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD COLUMN "class_description" text
    `);
    logger.info("Added class_description column to grievances", {
      service: "migration-grievance-006",
    });
  } else {
    logger.info("grievances.class_description already exists, skipping", {
      service: "migration-grievance-006",
    });
  }
}

const migration: Migration = {
  version: 6,
  name: "add_class_description_to_grievances",
  description:
    "Add a nullable class_description long-text column to grievances. Existing rows backfill to NULL. Idempotent: skips if the column already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
