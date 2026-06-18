import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'comm_postal'
        AND column_name = 'body'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("comm_postal.body column already exists, skipping creation", {
      service: "migration-1006",
    });
    return;
  }

  await db.execute(sql`
    ALTER TABLE comm_postal ADD COLUMN body text
  `);

  logger.info("Added body column to comm_postal", {
    service: "migration-1006",
  });
}

const migration: Migration = {
  version: 1006,
  name: "comm_postal_body",
  description: "Add nullable body column to comm_postal so the composed letter body is retained locally for both live and offline sends (task #244).",
  up,
};

registerMigration(migration);

export default migration;
