import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'help'
    ) AS exists
  `);
  const exists = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === "t";
  if (exists) {
    logger.info("help table already exists, skipping", { service: "migration-1053" });
    return;
  }

  await db.execute(sql`
    CREATE TABLE help (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      paths text[] NOT NULL DEFAULT '{}'::text[],
      summary text NOT NULL,
      details text,
      data jsonb
    )
  `);

  logger.info("Created help table", { service: "migration-1053" });
}

const migration: Migration = {
  version: 1113,
  name: "create_help",
  description:
    "Create the core help table for configurable per-page help text (path patterns with % wildcards, summary, limited-HTML details).",
  up,
};

registerMigration(migration);
