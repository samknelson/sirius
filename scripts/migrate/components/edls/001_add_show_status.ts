import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "edls";

async function up(): Promise<void> {
  const tableResult = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_edls_show_status'
    )
  `);
  const tableExists = tableResult.rows?.[0]?.exists === true || tableResult.rows?.[0]?.exists === 't';

  if (!tableExists) {
    await db.execute(sql`
      CREATE TABLE options_edls_show_status (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        sirius_id varchar(255),
        sequence integer NOT NULL DEFAULT 0,
        data jsonb,
        CONSTRAINT options_edls_show_status_sirius_id_unique UNIQUE (sirius_id)
      )
    `);
    logger.info("Created options_edls_show_status table", {
      service: "migration-edls-001",
    });
  } else {
    logger.info("options_edls_show_status table already exists, skipping creation", {
      service: "migration-edls-001",
    });
  }

  const columnResult = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'edls_sheets' AND column_name = 'show_status_id'
    )
  `);
  const columnExists = columnResult.rows?.[0]?.exists === true || columnResult.rows?.[0]?.exists === 't';

  if (!columnExists) {
    await db.execute(sql`
      ALTER TABLE edls_sheets
        ADD COLUMN show_status_id varchar
        CONSTRAINT edls_sheets_show_status_id_options_edls_show_status_id_fk
        REFERENCES options_edls_show_status(id) ON DELETE SET NULL
    `);
    logger.info("Added show_status_id column to edls_sheets", {
      service: "migration-edls-001",
    });
  } else {
    logger.info("edls_sheets.show_status_id already exists, skipping", {
      service: "migration-edls-001",
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "add_show_status",
  description: "Create the options_edls_show_status unified-options table and add the nullable show_status_id FK column to edls_sheets. Idempotent: skips each step if the table/column already exists (fresh enables create both via component schema push).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
