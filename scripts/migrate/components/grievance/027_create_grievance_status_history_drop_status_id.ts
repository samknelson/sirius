import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

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
 * Replace `grievances.status_id` with a `grievance_status_history` table.
 *
 * - Creates `grievance_status_history` (id, grievance_id cascade, status_id
 *   restrict, date timestamp NOT NULL with a not-in-the-future CHECK,
 *   is_current boolean, data jsonb) plus a partial unique index guaranteeing
 *   at most one current row per grievance and a unique (grievance_id, date).
 * - Drops the `status_id` column from `grievances` (its FK goes with it).
 *   Explicitly NO data migration: existing grievances start with an empty
 *   history and a blank status (test data only, decision confirmed).
 *
 * Idempotent: skips the table create if it exists (indexes/constraints use
 * IF NOT EXISTS) and skips the column drop if already gone.
 */
async function up(): Promise<void> {
  if (!(await tableExists("grievance_status_history"))) {
    await db.execute(sql`
      CREATE TABLE grievance_status_history (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "grievance_id" varchar NOT NULL,
        "status_id" varchar NOT NULL,
        "date" timestamp NOT NULL,
        "is_current" boolean NOT NULL DEFAULT false,
        "data" jsonb,
        CONSTRAINT grievance_status_history_grievance_id_grievances_id_fk
          FOREIGN KEY ("grievance_id") REFERENCES grievances (id) ON DELETE CASCADE,
        CONSTRAINT grievance_status_history_status_id_options_grievance_status_id_fk
          FOREIGN KEY ("status_id") REFERENCES options_grievance_status (id) ON DELETE RESTRICT,
        CONSTRAINT grievance_status_history_date_not_future
          CHECK ("date" <= now())
      )
    `);
    logger.info("Created grievance_status_history table", {
      service: "migration-grievance-027",
    });
  } else {
    logger.info("grievance_status_history already exists, skipping create", {
      service: "migration-grievance-027",
    });
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS grievance_status_history_one_current_per_grievance
    ON grievance_status_history ("grievance_id")
    WHERE "is_current" = true
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS grievance_status_history_grievance_date_unique
    ON grievance_status_history ("grievance_id", "date")
  `);

  if (await columnExists("grievances", "status_id")) {
    await db.execute(sql`ALTER TABLE grievances DROP COLUMN "status_id"`);
    logger.info("Dropped status_id column from grievances (no data migration by design)", {
      service: "migration-grievance-027",
    });
  } else {
    logger.info("grievances.status_id already gone, skipping drop", {
      service: "migration-grievance-027",
    });
  }
}

const migration: Migration = {
  version: 27,
  name: "create_grievance_status_history_drop_status_id",
  description:
    "Create the grievance_status_history table (grievance_id cascade, status_id restrict, date timestamp with a not-in-future CHECK, derived is_current with a partial unique index for at-most-one current per grievance, unique (grievance_id, date)) and drop grievances.status_id with NO data migration — existing grievances start with empty history. Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
