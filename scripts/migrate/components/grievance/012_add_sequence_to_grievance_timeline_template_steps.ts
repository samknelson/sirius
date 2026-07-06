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
 * Add a NOT NULL `sequence` integer (default 0) to
 * grievance_timeline_template_steps so admins can manually order the steps of a
 * timeline template via Move Up / Move Down, matching the sequencing model used
 * by the unified-options tables.
 *
 * Existing rows are backfilled per template so they keep the order they
 * currently render in (steps were previously sorted by the referenced step
 * option's sequence). The add + backfill run in one transaction.
 *
 * Idempotent: skips entirely if the column already exists.
 */
async function up(): Promise<void> {
  if (await columnExists("grievance_timeline_template_steps", "sequence")) {
    logger.info("grievance_timeline_template_steps.sequence already exists, skipping", {
      service: "migration-grievance-012",
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      ALTER TABLE grievance_timeline_template_steps
      ADD COLUMN sequence integer NOT NULL DEFAULT 0
    `);
    await tx.execute(sql`
      WITH ordered AS (
        SELECT s.id,
          ROW_NUMBER() OVER (
            PARTITION BY s.template_id
            ORDER BY o.sequence ASC NULLS LAST, s.id ASC
          ) - 1 AS seq
        FROM grievance_timeline_template_steps s
        LEFT JOIN options_grievance_steps o ON s.step_id = o.id
      )
      UPDATE grievance_timeline_template_steps t
      SET sequence = ordered.seq
      FROM ordered
      WHERE t.id = ordered.id
    `);
  });

  logger.info("Added sequence column to grievance_timeline_template_steps and backfilled per-template order", {
    service: "migration-grievance-012",
  });
}

const migration: Migration = {
  version: 12,
  name: "add_sequence_to_grievance_timeline_template_steps",
  description:
    "Add a NOT NULL sequence integer (default 0) to grievance_timeline_template_steps for manual step ordering. Backfills existing rows per template by their current display order. Idempotent: skips if the column already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
