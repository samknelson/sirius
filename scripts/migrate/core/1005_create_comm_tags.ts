import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'comm_tags'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("comm_tags table already exists, skipping creation", {
      service: "migration-1005",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE comm_tags (
      comm_id varchar NOT NULL REFERENCES comm(id) ON DELETE CASCADE,
      comm_tag_id varchar NOT NULL REFERENCES options_comm_tags(id) ON DELETE CASCADE,
      CONSTRAINT comm_tags_pkey PRIMARY KEY (comm_id, comm_tag_id)
    )
  `);

  await db.execute(sql`
    CREATE INDEX comm_tags_comm_tag_id_idx ON comm_tags (comm_tag_id)
  `);

  logger.info("Created comm_tags join table", {
    service: "migration-1005",
  });
}

const migration: Migration = {
  version: 1005,
  name: "create_comm_tags",
  description: "Create the comm_tags join table linking comm to options_comm_tags (many-to-many). Versioned at 1005 because the dev DB's migrations_version counter has been advanced past the 0-999 core range by baseline scripts (>=1000); 1004 created options_comm_tags.",
  up,
};

registerMigration(migration);

export default migration;
