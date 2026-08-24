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
  if (!(await columnExists('notes'))) {
    await db.execute(sql`ALTER TABLE edls_sheets ADD COLUMN notes text`);
    logger.info("Added notes column to edls_sheets", { service: "migration-edls-002" });
  } else {
    logger.info("edls_sheets.notes already exists, skipping", { service: "migration-edls-002" });
  }

  if (!(await columnExists('created_by'))) {
    await db.execute(sql`
      ALTER TABLE edls_sheets
        ADD COLUMN created_by varchar
        CONSTRAINT edls_sheets_created_by_users_id_fk
        REFERENCES users(id) ON DELETE SET NULL
    `);
    logger.info("Added created_by column to edls_sheets", { service: "migration-edls-002" });
  } else {
    logger.info("edls_sheets.created_by already exists, skipping", { service: "migration-edls-002" });
  }

  // Existing rows take the DEFAULT now() as their first "changed" value; the
  // storage layer refreshes it on every subsequent save.
  if (!(await columnExists('changed'))) {
    await db.execute(sql`
      ALTER TABLE edls_sheets
        ADD COLUMN changed timestamp NOT NULL DEFAULT now()
    `);
    logger.info("Added changed column to edls_sheets", { service: "migration-edls-002" });
  } else {
    logger.info("edls_sheets.changed already exists, skipping", { service: "migration-edls-002" });
  }
}

const migration: Migration = {
  version: 2,
  name: "add_sheet_notes_and_change_tracking",
  description: "Add free-text notes, a nullable created_by user FK (ON DELETE SET NULL) and a NOT NULL changed timestamp (DEFAULT now()) to edls_sheets. Existing rows take the timestamp default and keep a null creator. Idempotent: each column is added only when absent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
