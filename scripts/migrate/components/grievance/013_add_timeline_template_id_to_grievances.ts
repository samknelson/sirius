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
 * Add a nullable `timeline_template_id` varchar to grievances so a grievance
 * can be associated with a grievance timeline template. The FK is
 * ON DELETE SET NULL: deleting a template leaves referencing grievances intact
 * with their selection cleared.
 *
 * Idempotent: skips entirely if the column already exists. The inline
 * REFERENCES clause creates both the column and the FK constraint in one
 * statement.
 */
async function up(): Promise<void> {
  if (await columnExists("grievances", "timeline_template_id")) {
    logger.info("grievances.timeline_template_id already exists, skipping", {
      service: "migration-grievance-013",
    });
    return;
  }

  await db.execute(sql`
    ALTER TABLE grievances
    ADD COLUMN timeline_template_id varchar
    REFERENCES grievance_timeline_templates(id) ON DELETE SET NULL
  `);

  logger.info("Added timeline_template_id column to grievances", {
    service: "migration-grievance-013",
  });
}

const migration: Migration = {
  version: 13,
  name: "add_timeline_template_id_to_grievances",
  description:
    "Add a nullable timeline_template_id varchar FK to grievances referencing grievance_timeline_templates (ON DELETE SET NULL) so a grievance can be linked to a timeline template. Idempotent: skips if the column already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
