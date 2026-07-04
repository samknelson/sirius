import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sitespecific_bao_employer_immediate_eligibility'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("sitespecific_bao_employer_immediate_eligibility table already exists, skipping creation", {
      service: "migration-sitespecific.bao-001",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE sitespecific_bao_employer_immediate_eligibility (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      employer_id varchar NOT NULL UNIQUE REFERENCES employers(id) ON DELETE CASCADE,
      start_ymd date NOT NULL,
      end_ymd date NOT NULL,
      data jsonb
    )
  `);

  logger.info("Created sitespecific_bao_employer_immediate_eligibility table", {
    service: "migration-sitespecific.bao-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_bao_employer_immediate_eligibility",
  description:
    "Create the sitespecific_bao_employer_immediate_eligibility table owned by the sitespecific.bao component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
