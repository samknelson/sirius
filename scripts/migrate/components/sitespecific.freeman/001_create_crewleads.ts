import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.freeman";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sitespecific_freeman_crewleads'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("sitespecific_freeman_crewleads table already exists, skipping creation", {
      service: "migration-sitespecific.freeman-001",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE sitespecific_freeman_crewleads (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      sirius_id varchar UNIQUE NOT NULL,
      name text NOT NULL,
      data jsonb
    )
  `);

  logger.info("Created sitespecific_freeman_crewleads table", {
    service: "migration-sitespecific.freeman-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_freeman_crewleads",
  description:
    "Create the sitespecific_freeman_crewleads table owned by the sitespecific.freeman component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
