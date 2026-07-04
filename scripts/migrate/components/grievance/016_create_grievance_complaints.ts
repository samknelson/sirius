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
 * Create the grievance_complaints child table owned by the grievance
 * component. Each row is one ordered complaint line on a grievance. The
 * grievance FK CASCADEs on delete (a complaint line is meaningless without
 * its grievance); the optional options_grievance_complaints FK is
 * ON DELETE SET NULL so removing a complaint option leaves existing lines
 * intact with their selection cleared. `description` holds the free-text
 * (typically copied from the selected option) and is NOT NULL.
 *
 * Idempotent: skips creation if the table already exists (the enable flow
 * may create it via component schema push first).
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_complaints")) {
    logger.info("grievance_complaints table already exists, skipping creation", {
      service: "migration-grievance-016",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE grievance_complaints (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
      complaint_id varchar REFERENCES options_grievance_complaints(id) ON DELETE SET NULL,
      description text NOT NULL,
      sequence integer NOT NULL DEFAULT 0
    )
  `);

  logger.info("Created grievance_complaints table", {
    service: "migration-grievance-016",
  });
}

const migration: Migration = {
  version: 16,
  name: "create_grievance_complaints",
  description:
    "Create the grievance_complaints child table owned by the grievance component. FK to grievances CASCADEs on delete; optional FK to options_grievance_complaints is ON DELETE SET NULL; description is NOT NULL; sequence orders the lines. Idempotent: skips creation if the table already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
