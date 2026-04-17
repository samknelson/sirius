import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

async function up(): Promise<void> {
  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'edls_sheets' AND column_name = 'job_group_id'
    ) AS exists
  `);

  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';

  if (hasColumn) {
    logger.info("edls_sheets.job_group_id column already exists, skipping", {
      service: "migration-005",
    });
    return;
  }

  await db.execute(sql`
    ALTER TABLE edls_sheets
    ADD COLUMN job_group_id varchar REFERENCES dispatch_job_group(id) ON DELETE SET NULL
  `);

  logger.info("Added job_group_id column to edls_sheets", {
    service: "migration-005",
  });
}

const migration: Migration = {
  version: 5,
  name: "add_edls_sheet_job_group",
  up,
};

registerMigration(migration);
