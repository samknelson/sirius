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
 * Add a NOT NULL `sequence` integer (default 0) to options_grievance_status so
 * grievance statuses can be manually ordered via the unified-options admin
 * screen, matching the sequencing model used by the other options tables.
 *
 * Existing rows backfill to 0 automatically when the column is added; the
 * operator can then reorder them with the Move Up / Move Down controls.
 *
 * Idempotent: skips the column if it already exists.
 */
async function up(): Promise<void> {
  if (!(await columnExists("options_grievance_status", "sequence"))) {
    await db.execute(sql`
      ALTER TABLE options_grievance_status
      ADD COLUMN sequence integer NOT NULL DEFAULT 0
    `);
    logger.info("Added sequence column to options_grievance_status", {
      service: "migration-grievance-008",
    });
  } else {
    logger.info("options_grievance_status.sequence already exists, skipping", {
      service: "migration-grievance-008",
    });
  }
}

const migration: Migration = {
  version: 8,
  name: "add_sequence_to_options_grievance_status",
  description:
    "Add a NOT NULL sequence integer (default 0) to options_grievance_status for manual ordering. Existing rows backfill to 0. Idempotent: skips the column if it already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
