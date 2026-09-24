import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_note_type'
    ) AS exists
  `);
  const exists = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === "t";
  if (exists) {
    logger.info("options_note_type table already exists, skipping", { service: "migration-1057" });
    return;
  }

  await db.execute(sql`
    CREATE TABLE options_note_type (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      description text,
      sirius_id text UNIQUE,
      data jsonb
    )
  `);

  logger.info("Created options_note_type table", { service: "migration-1057" });
}

const migration: Migration = {
  version: 1057,
  name: "create_options_note_type",
  description:
    "Create the options_note_type table: admin-configurable note types, each declaring which record types it applies to (data.entityTypes).",
  up,
};

registerMigration(migration);
