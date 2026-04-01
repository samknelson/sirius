import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

async function up(): Promise<void> {
  const columnCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name = 'cardchecks' 
        AND column_name = 'source_nid'
    ) AS exists
  `);

  const hasOldColumn = columnCheck.rows[0]?.exists === true || columnCheck.rows[0]?.exists === 't';

  if (!hasOldColumn) {
    logger.info("Column source_nid already renamed or does not exist, skipping", {
      service: "migration-003",
    });
    return;
  }

  await db.execute(sql`ALTER TABLE cardchecks RENAME COLUMN source_nid TO external_id`);

  await db.execute(sql`DROP INDEX IF EXISTS idx_cardchecks_source_nid`);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cardchecks_external_id 
    ON cardchecks (external_id) 
    WHERE external_id IS NOT NULL
  `);

  logger.info("Renamed cardchecks.source_nid to external_id", {
    service: "migration-003",
  });
}

const migration: Migration = {
  version: 3,
  name: "rename_source_nid_to_external_id",
  description: "Renames cardchecks.source_nid column to external_id for clarity",
  up,
};

registerMigration(migration);

export default migration;
