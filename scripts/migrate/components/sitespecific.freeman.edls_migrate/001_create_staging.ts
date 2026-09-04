import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import {
  registerComponentMigration,
  type Migration,
} from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.freeman.edls_migrate";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sitespecific_freeman_edls_migrate'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";

  if (exists) {
    logger.info(
      "sitespecific_freeman_edls_migrate table already exists, skipping creation",
      { service: "migration-sitespecific.freeman.edls_migrate-001" },
    );
    return;
  }

  // Matches what the component enable path pushes from the Drizzle definition:
  // a named UNIQUE constraint on nid (not a unique index) and a jsonb default.
  await db.execute(sql`
    CREATE TABLE sitespecific_freeman_edls_migrate (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      nid varchar NOT NULL,
      type varchar NOT NULL,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT sitespecific_freeman_edls_migrate_nid_unique UNIQUE (nid)
    )
  `);

  logger.info("Created sitespecific_freeman_edls_migrate table", {
    service: "migration-sitespecific.freeman.edls_migrate-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_freeman_edls_migrate_staging",
  description:
    "Create the sitespecific_freeman_edls_migrate staging table owned by the sitespecific.freeman.edls_migrate component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
