import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "edls";

async function columnExists(column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'edls_sheets'
        AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
}

async function up(): Promise<void> {
  // NOT NULL DEFAULT false, matching the schema declaration exactly: existing
  // sheets take the default, so every sheet that predates the column starts
  // with worker notifications switched OFF and only the toggle endpoint can
  // turn one on.
  if (!(await columnExists('notifications_enabled'))) {
    await db.execute(sql`
      ALTER TABLE edls_sheets
        ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT false
    `);
    logger.info("Added notifications_enabled column to edls_sheets", { service: "migration-edls-005" });
  } else {
    logger.info("edls_sheets.notifications_enabled already exists, skipping", { service: "migration-edls-005" });
  }
}

const migration: Migration = {
  version: 5,
  name: "add_sheet_notifications_enabled",
  description: "Add a NOT NULL boolean notifications_enabled column (DEFAULT false) to edls_sheets holding the sheet's per-sheet opt-in for worker-facing notifications. Existing sheets take the default and notify nobody until the flag is turned on. Idempotent: the column is added only when absent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
