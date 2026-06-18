import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'workers' AND column_name = 'data'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    await db.execute(sql`
      ALTER TABLE workers ADD COLUMN data jsonb
    `);
    logger.info("Added data jsonb column to workers", {
      service: "migration-1011",
    });
  }
}

const migration: Migration = {
  version: 1011,
  name: "add_workers_data",
  description: "Add generic data jsonb column to workers (used for sitespecific JSON blobs)",
  up,
};

registerMigration(migration);
