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
 * Create the grievance timeline template tables owned by the grievance
 * component: `grievance_timeline_templates` (a named, reusable timeline) and
 * `grievance_timeline_template_steps` (the ordered transitions inside a
 * template).
 *
 * Each step records the statuses it applies from/to (stored as varchar arrays
 * of options_grievance_status ids), the grievance step it represents
 * (options_grievance_steps, RESTRICT so a referenced step definition cannot be
 * deleted out from under a template), and a duration (`days` + `day_type`,
 * calendar or business). The step -> template FK CASCADEs so deleting a
 * template removes its steps.
 *
 * Idempotent and convergent: guards each table creation independently (the
 * enable flow may create them via component schema push first) so a
 * partially-applied state still converges on re-run.
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_timeline_templates")) {
    logger.info("grievance_timeline_templates table already exists, skipping creation", {
      service: "migration-grievance-011",
    });
  } else {
    await db.execute(sql`
      CREATE TABLE grievance_timeline_templates (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar(255) NOT NULL,
        description text,
        data jsonb
      )
    `);
    logger.info("Created grievance_timeline_templates table", {
      service: "migration-grievance-011",
    });
  }

  if (await tableExists("grievance_timeline_template_steps")) {
    logger.info("grievance_timeline_template_steps table already exists, skipping creation", {
      service: "migration-grievance-011",
    });
  } else {
    await db.execute(sql`
      CREATE TABLE grievance_timeline_template_steps (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id varchar NOT NULL REFERENCES grievance_timeline_templates(id) ON DELETE CASCADE,
        from_statuses varchar[] NOT NULL,
        to_statuses varchar[] NOT NULL,
        step_id varchar NOT NULL REFERENCES options_grievance_steps(id) ON DELETE RESTRICT,
        days integer NOT NULL,
        day_type varchar NOT NULL
      )
    `);
    logger.info("Created grievance_timeline_template_steps table", {
      service: "migration-grievance-011",
    });
  }
}

const migration: Migration = {
  version: 11,
  name: "create_grievance_timeline_templates",
  description:
    "Create the grievance_timeline_templates and grievance_timeline_template_steps tables owned by the grievance component. Templates are named reusable timelines; steps record from/to status id arrays, the referenced grievance step (RESTRICT), and a calendar/business day duration. The step->template FK CASCADEs. Idempotent: guards each table creation independently.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
