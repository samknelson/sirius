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
 * Create the grievance_name_denorm payload table owned by the grievance
 * component. Holds the precomputed display name for each grievance (one row per
 * grievance). `denorm_id` ties the row back to its workflow status row in the
 * core `denorm` table (ON DELETE CASCADE); `grievance_id` CASCADEs so the row
 * disappears with its grievance. Both are UNIQUE (0-or-1 payload per grievance,
 * 0-or-1 payload per denorm status row).
 *
 * Idempotent: skips creation if the table already exists (the enable flow may
 * create it via component schema push first).
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_name_denorm")) {
    logger.info("grievance_name_denorm table already exists, skipping creation", {
      service: "migration-grievance-022",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE grievance_name_denorm (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      denorm_id varchar NOT NULL REFERENCES denorm(id) ON DELETE CASCADE,
      grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
      name varchar
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX grievance_name_denorm_grievance_uniq
    ON grievance_name_denorm (grievance_id)
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX grievance_name_denorm_denorm_uniq
    ON grievance_name_denorm (denorm_id)
  `);

  logger.info("Created grievance_name_denorm table", {
    service: "migration-grievance-022",
  });
}

const migration: Migration = {
  version: 22,
  name: "create_grievance_name_denorm",
  description:
    "Create the grievance_name_denorm payload table owned by the grievance component. One row per grievance holding the precomputed display name. denorm_id FK -> denorm(id) and grievance_id FK -> grievances(id) both CASCADE on delete; both columns UNIQUE. Idempotent: skips creation if the table already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
