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
 * Replace the hand-maintained `grievance_steps` table with the
 * plugin-computed `grievance_steps_denorm` table.
 *
 * - Drops `grievance_steps` outright. Explicitly NO data migration: the table
 *   was a design mistake and its rows are recomputable from the grievance's
 *   timeline template + status history (decision confirmed).
 * - Creates `grievance_steps_denorm` (id, denorm_id → denorm cascade,
 *   grievance_id → grievances cascade, step_id → options_grievance_steps
 *   cascade, started/due/completed date columns, is_current boolean, data
 *   jsonb) plus a partial unique index guaranteeing at most one current row
 *   per grievance. The table is written ONLY by the `grievance_timeline`
 *   denorm plugin.
 *
 * Idempotent: skips the drop if the table is already gone and the create if
 * the new table already exists (index uses IF NOT EXISTS).
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_steps")) {
    await db.execute(sql`DROP TABLE grievance_steps`);
    logger.info("Dropped grievance_steps table (no data migration by design)", {
      service: "migration-grievance-028",
    });
  } else {
    logger.info("grievance_steps already gone, skipping drop", {
      service: "migration-grievance-028",
    });
  }

  if (!(await tableExists("grievance_steps_denorm"))) {
    await db.execute(sql`
      CREATE TABLE grievance_steps_denorm (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "denorm_id" varchar NOT NULL,
        "grievance_id" varchar NOT NULL,
        "step_id" varchar NOT NULL,
        "started_ymd" date,
        "due_ymd" date,
        "completed_ymd" date,
        "is_current" boolean NOT NULL DEFAULT false,
        "data" jsonb,
        CONSTRAINT grievance_steps_denorm_denorm_id_denorm_id_fk
          FOREIGN KEY ("denorm_id") REFERENCES denorm (id) ON DELETE CASCADE,
        CONSTRAINT grievance_steps_denorm_grievance_id_grievances_id_fk
          FOREIGN KEY ("grievance_id") REFERENCES grievances (id) ON DELETE CASCADE,
        CONSTRAINT grievance_steps_denorm_step_id_options_grievance_steps_id_fk
          FOREIGN KEY ("step_id") REFERENCES options_grievance_steps (id) ON DELETE CASCADE
      )
    `);
    logger.info("Created grievance_steps_denorm table", {
      service: "migration-grievance-028",
    });
  } else {
    logger.info("grievance_steps_denorm already exists, skipping create", {
      service: "migration-grievance-028",
    });
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS grievance_steps_denorm_one_current_per_grievance
    ON grievance_steps_denorm ("grievance_id")
    WHERE is_current = true
  `);
}

const migration: Migration = {
  version: 28,
  name: "replace_grievance_steps_with_denorm",
  description:
    "Drop the hand-maintained grievance_steps table (NO data migration by design) and create grievance_steps_denorm — the payload table for the grievance_timeline denorm plugin (denorm_id/grievance_id/step_id FKs cascade, started/due/completed date columns, is_current with a partial unique index enforcing at most one current step per grievance). Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
