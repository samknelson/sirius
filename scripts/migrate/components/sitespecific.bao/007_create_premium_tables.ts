import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-007";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("sitespecific_bao_premium_rates"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_premium_rates (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        benefit_id varchar NOT NULL,
        coverage_tier varchar NOT NULL,
        rate numeric(10,2) NOT NULL,
        effective_ymd date NOT NULL,
        data jsonb,
        CONSTRAINT sitespecific_bao_premium_rates_benefit_tier_effective_uq
          UNIQUE (benefit_id, coverage_tier, effective_ymd),
        CONSTRAINT sitespecific_bao_premium_rates_benefit_id_fkey
          FOREIGN KEY (benefit_id) REFERENCES trust_benefits(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created sitespecific_bao_premium_rates table", { service: SERVICE });
  }

  if (!(await tableExists("sitespecific_bao_premium_files"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_premium_files (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id varchar NOT NULL,
        account_id varchar NOT NULL,
        ea_id varchar NOT NULL,
        generated_at timestamp NOT NULL DEFAULT now(),
        total_amount numeric(12,2) NOT NULL,
        row_count integer NOT NULL,
        data jsonb,
        CONSTRAINT sitespecific_bao_premium_files_provider_id_fkey
          FOREIGN KEY (provider_id) REFERENCES trust_providers(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_premium_files_account_id_fkey
          FOREIGN KEY (account_id) REFERENCES ledger_accounts(id),
        CONSTRAINT sitespecific_bao_premium_files_ea_id_fkey
          FOREIGN KEY (ea_id) REFERENCES ledger_ea(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created sitespecific_bao_premium_files table", { service: SERVICE });
  }

  if (!(await tableExists("sitespecific_bao_premium_file_rows"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_premium_file_rows (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        file_id varchar NOT NULL,
        worker_id varchar,
        benefit_id varchar,
        statement_ymd date NOT NULL,
        amount numeric(10,2) NOT NULL,
        data jsonb,
        CONSTRAINT sitespecific_bao_premium_file_rows_file_id_fkey
          FOREIGN KEY (file_id) REFERENCES sitespecific_bao_premium_files(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created sitespecific_bao_premium_file_rows table", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 7,
  name: "create_bao_premium_tables",
  description:
    "Create provider premium accounting tables: sitespecific_bao_premium_rates (effective-dated monthly premium per benefit + coverage tier), sitespecific_bao_premium_files (generated provider premium files), and sitespecific_bao_premium_file_rows (per worker/benefit/statement-month snapshot lines). Idempotent: each CREATE is skipped when the table already exists (the enable flow creates them via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
