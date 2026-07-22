import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-006";

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
  if (!(await tableExists("sitespecific_bao_dp_rates"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_dp_rates (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        benefit_id varchar NOT NULL,
        tier_transition varchar NOT NULL,
        rate numeric(10,2) NOT NULL,
        effective_ymd date NOT NULL,
        provisional boolean NOT NULL DEFAULT false,
        data jsonb,
        CONSTRAINT sitespecific_bao_dp_rates_benefit_transition_effective_uq
          UNIQUE (benefit_id, tier_transition, effective_ymd),
        CONSTRAINT sitespecific_bao_dp_rates_benefit_id_fkey
          FOREIGN KEY (benefit_id) REFERENCES trust_benefits(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created sitespecific_bao_dp_rates table", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 6,
  name: "create_bao_dp_rates",
  description:
    "Create sitespecific_bao_dp_rates: an effective-dated Domestic Partner rate table keyed by (benefit, coverage-tier transition, effective date), with a provisional flag for placeholder rows (the family → family-with-DP transition has no confirmed business rule yet). Idempotent: creation is skipped when the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
