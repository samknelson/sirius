import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'snapshots'
    ) AS exists
  `);
  const exists = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (exists) {
    logger.info("snapshots table already exists, skipping", { service: "migration-1047" });
    return;
  }

  await db.execute(sql`
    CREATE TABLE snapshots (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type varchar(100) NOT NULL,
      entity_id varchar NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      author_id varchar REFERENCES users(id) ON DELETE SET NULL,
      author_name text,
      label text,
      data jsonb NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE INDEX snapshots_entity_type_entity_id_created_at_idx
    ON snapshots (entity_type, entity_id, created_at)
  `);

  logger.info("Created snapshots table with entity index", { service: "migration-1047" });
}

const migration: Migration = {
  version: 1047,
  name: "create_snapshots",
  description: "Create the core snapshots table (generic point-in-time entity copies) with its (entity_type, entity_id, created_at) index",
  up,
};

registerMigration(migration);
