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

async function constraintExists(table: string, constraint: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ${table}::regclass AND conname = ${constraint}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Add an optional unique `sirius_id` column and a NOT NULL `open` boolean
 * (default true) to options_grievance_status.
 *
 * - `sirius_id`: nullable varchar; multiple NULLs are allowed, non-null
 *   values must be unique (enforced by the named unique constraint so the
 *   reflected DDL matches the Drizzle `.unique()` declaration).
 * - `open`: NOT NULL boolean defaulting to true; existing rows backfill to
 *   true automatically when the column is added.
 *
 * Idempotent: skips each column/constraint that already exists.
 */
async function up(): Promise<void> {
  if (!(await columnExists("options_grievance_status", "sirius_id"))) {
    await db.execute(sql`
      ALTER TABLE options_grievance_status ADD COLUMN sirius_id varchar
    `);
    logger.info("Added sirius_id column to options_grievance_status", {
      service: "migration-grievance-007",
    });
  } else {
    logger.info("options_grievance_status.sirius_id already exists, skipping", {
      service: "migration-grievance-007",
    });
  }

  if (!(await constraintExists("options_grievance_status", "options_grievance_status_sirius_id_unique"))) {
    await db.execute(sql`
      ALTER TABLE options_grievance_status
      ADD CONSTRAINT options_grievance_status_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint options_grievance_status_sirius_id_unique", {
      service: "migration-grievance-007",
    });
  } else {
    logger.info("options_grievance_status_sirius_id_unique already exists, skipping", {
      service: "migration-grievance-007",
    });
  }

  if (!(await columnExists("options_grievance_status", "open"))) {
    await db.execute(sql`
      ALTER TABLE options_grievance_status
      ADD COLUMN "open" boolean NOT NULL DEFAULT true
    `);
    logger.info("Added open column to options_grievance_status", {
      service: "migration-grievance-007",
    });
  } else {
    logger.info("options_grievance_status.open already exists, skipping", {
      service: "migration-grievance-007",
    });
  }
}

const migration: Migration = {
  version: 7,
  name: "add_sirius_id_and_open_to_options_grievance_status",
  description:
    "Add optional unique sirius_id column and a NOT NULL open boolean (default true) to options_grievance_status. Existing rows backfill open to true. Idempotent: skips columns/constraint that already exist.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
