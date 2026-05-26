import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_comm_tags'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("options_comm_tags table already exists, skipping creation", {
      service: "migration-1004",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE options_comm_tags (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL,
      description text,
      sirius_id varchar(255),
      data jsonb,
      CONSTRAINT options_comm_tags_sirius_id_unique UNIQUE (sirius_id)
    )
  `);

  logger.info("Created options_comm_tags table", {
    service: "migration-1004",
  });
}

const migration: Migration = {
  version: 1004,
  name: "create_options_comm_tags",
  description: "Create the options_comm_tags table for the Comm Tags dropdown list. Versioned at 1004 because the dev DB's migrations_version counter has been advanced past the 0-999 core range by baseline scripts (>=1000).",
  up,
};

registerMigration(migration);

export default migration;
