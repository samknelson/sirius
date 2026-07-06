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
 * Create the grievance_remedies child table owned by the grievance
 * component. Each row is one ordered remedy line on a grievance. The
 * grievance FK CASCADEs on delete (a remedy line is meaningless without
 * its grievance); the optional options_grievance_remedies FK is
 * ON DELETE SET NULL so removing a remedy option leaves existing lines
 * intact with their selection cleared. `description` holds the free-text
 * (typically copied from the selected option) and is NOT NULL.
 *
 * Idempotent: skips creation if the table already exists (the enable flow
 * may create it via component schema push first).
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_remedies")) {
    logger.info("grievance_remedies table already exists, skipping creation", {
      service: "migration-grievance-017",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE grievance_remedies (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
      remedy_id varchar REFERENCES options_grievance_remedies(id) ON DELETE SET NULL,
      description text NOT NULL,
      sequence integer NOT NULL DEFAULT 0
    )
  `);

  logger.info("Created grievance_remedies table", {
    service: "migration-grievance-017",
  });
}

const migration: Migration = {
  version: 17,
  name: "create_grievance_remedies",
  description:
    "Create the grievance_remedies child table owned by the grievance component. FK to grievances CASCADEs on delete; optional FK to options_grievance_remedies is ON DELETE SET NULL; description is NOT NULL; sequence orders the lines. Idempotent: skips creation if the table already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
