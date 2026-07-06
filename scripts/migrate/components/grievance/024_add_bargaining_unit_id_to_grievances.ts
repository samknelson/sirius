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

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Add a nullable `bargaining_unit_id` varchar column to the grievances table,
 * referencing the core `bargaining_units` table with ON DELETE SET NULL.
 * Surfaced in the UI (view/create/edit) only when the `bargainingunits`
 * component is enabled. Existing rows backfill to NULL automatically.
 *
 * Idempotent: skips the column add and the constraint add if they already
 * exist, so a re-run is safe.
 */
async function up(): Promise<void> {
  if (!(await columnExists("grievances", "bargaining_unit_id"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD COLUMN "bargaining_unit_id" varchar
    `);
    logger.info("Added bargaining_unit_id column to grievances", {
      service: "migration-grievance-024",
    });
  } else {
    logger.info("grievances.bargaining_unit_id already exists, skipping", {
      service: "migration-grievance-024",
    });
  }

  if (!(await constraintExists("grievances_bargaining_unit_id_bargaining_units_id_fk"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD CONSTRAINT grievances_bargaining_unit_id_bargaining_units_id_fk
      FOREIGN KEY ("bargaining_unit_id") REFERENCES bargaining_units (id)
      ON DELETE SET NULL
    `);
    logger.info("Added bargaining_unit_id FK constraint to grievances", {
      service: "migration-grievance-024",
    });
  } else {
    logger.info("grievances bargaining_unit_id FK already exists, skipping", {
      service: "migration-grievance-024",
    });
  }
}

const migration: Migration = {
  version: 24,
  name: "add_bargaining_unit_id_to_grievances",
  description:
    "Add a nullable bargaining_unit_id varchar column to grievances referencing core bargaining_units (ON DELETE SET NULL). Existing rows backfill to NULL. Idempotent: skips the column and constraint adds if present.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
