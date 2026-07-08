import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sitespecific_bao_employer_rates'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("sitespecific_bao_employer_rates table already exists, skipping creation", {
      service: "migration-sitespecific.bao-002",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE sitespecific_bao_employer_rates (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      employer_id varchar NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
      account_id varchar NOT NULL REFERENCES ledger_accounts(id) ON DELETE CASCADE,
      rate numeric(10,4) NOT NULL,
      effective_ymd date NOT NULL,
      data jsonb,
      CONSTRAINT sitespecific_bao_employer_rates_employer_account_effective_uq
        UNIQUE (employer_id, account_id, effective_ymd)
    )
  `);

  logger.info("Created sitespecific_bao_employer_rates table", {
    service: "migration-sitespecific.bao-002",
  });
}

const migration: Migration = {
  version: 2,
  name: "create_bao_employer_rates",
  description:
    "Create the sitespecific_bao_employer_rates table (per employer, per fund account, effective-dated hourly rates) owned by the sitespecific.bao component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
