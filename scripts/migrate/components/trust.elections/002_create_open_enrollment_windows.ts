import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.elections";

/**
 * Create the `open_enrollment_windows` admin-config table.
 *
 * Each row is an Open Enrollment window: a plan year plus the calendar
 * window (`start_ymd`..`end_ymd`) during which the Open Enrollment wizard
 * may be run. `plan_year` is unique (one window per plan year).
 *
 * Owned by the `trust.elections` component. On a fresh enable the
 * schema-push already creates this table (it is in the elections schema
 * module), so this statement is a no-op there.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS never overwrites an existing table.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS open_enrollment_windows (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_year integer NOT NULL UNIQUE,
      start_ymd date NOT NULL,
      end_ymd date NOT NULL,
      notes varchar,
      data jsonb
    )
  `);
  logger.info("Created open_enrollment_windows table", {
    service: "migration-trust.elections-002",
  });
}

const migration: Migration = {
  version: 2,
  name: "create_open_enrollment_windows",
  description:
    "Create the open_enrollment_windows admin-config table (plan year + calendar window). Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
