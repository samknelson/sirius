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
 * Add a required `cardinality` column to the grievances table.
 *
 * Allowed values are "individual", "multiple", "multiple-with-lead", and
 * "class" (enforced at the application layer via Zod). The column is NOT NULL
 * with a server-side default of 'individual', so existing rows backfill to
 * 'individual' automatically when the column is added.
 *
 * Idempotent: skips if the column already exists.
 */
async function up(): Promise<void> {
  if (!(await columnExists("grievances", "cardinality"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD COLUMN cardinality varchar NOT NULL DEFAULT 'individual'
    `);
    logger.info("Added cardinality column to grievances", {
      service: "migration-grievance-004",
    });
  } else {
    logger.info("grievances.cardinality already exists, skipping", {
      service: "migration-grievance-004",
    });
  }
}

const migration: Migration = {
  version: 4,
  name: "add_cardinality_to_grievances",
  description:
    "Add a required cardinality column to grievances (individual | multiple | multiple-with-lead | class) with a NOT NULL DEFAULT 'individual'. Existing rows backfill to 'individual' via the column default. Idempotent: skips if the column already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
