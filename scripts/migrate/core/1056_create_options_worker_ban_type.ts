import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_worker_ban_type'
    ) AS exists
  `);
  const exists = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === "t";
  if (exists) {
    logger.info("options_worker_ban_type table already exists, skipping", { service: "migration-1056" });
    return;
  }

  await db.execute(sql`
    CREATE TABLE options_worker_ban_type (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      description text,
      sirius_id text UNIQUE,
      data jsonb
    )
  `);

  logger.info("Created options_worker_ban_type table", { service: "migration-1056" });
}

const migration: Migration = {
  version: 1056,
  name: "create_options_worker_ban_type",
  description:
    "Create the options_worker_ban_type table: admin-configurable worker ban types, each selecting which worker-ban plugins apply (data.pluginIds).",
  up,
};

registerMigration(migration);
