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

/**
 * Create the grievance_steps per-grievance tracking table owned by the
 * grievance component. This is distinct from options_grievance_steps (the
 * config/options catalog of step definitions): grievance_steps records which
 * step a specific grievance is on, with date tracking and an active flag.
 *
 * Foreign keys CASCADE on delete (a step row is meaningless without its
 * grievance, and once a step definition is removed its per-grievance rows go
 * too). The partial unique index enforces at most one active step per
 * grievance. `active` is not a reserved word so the predicate is declared
 * unquoted to match what the startup drift gate reflects from Postgres.
 *
 * Idempotent and convergent: guards only the table creation (the enable flow
 * may create it via component schema push first), then ALWAYS (re)asserts the
 * partial unique index with IF NOT EXISTS so a partially-applied or
 * manually-repaired state (table present but index missing) still converges.
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_steps")) {
    logger.info("grievance_steps table already exists, skipping creation", {
      service: "migration-grievance-010",
    });
  } else {
    await db.execute(sql`
      CREATE TABLE grievance_steps (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
        step_id varchar NOT NULL REFERENCES options_grievance_steps(id) ON DELETE CASCADE,
        started_ymd date,
        due_ymd date,
        completed_ymd date,
        active boolean NOT NULL DEFAULT false,
        data jsonb
      )
    `);
    logger.info("Created grievance_steps table", {
      service: "migration-grievance-010",
    });
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS grievance_steps_one_active_per_grievance
    ON grievance_steps (grievance_id)
    WHERE active = true
  `);
}

const migration: Migration = {
  version: 10,
  name: "create_grievance_steps",
  description:
    "Create the grievance_steps per-grievance tracking table owned by the grievance component. FKs to grievances and options_grievance_steps CASCADE on delete; date columns track started/due/completed; a partial unique index enforces at most one active step per grievance. Idempotent: skips creation if the table already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
