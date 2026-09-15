import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import {
  registerComponentMigration,
  type Migration,
} from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-1147";
const TABLE = "sitespecific_bao_ee_contribution_rates";

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
  if (await tableExists(TABLE)) return;

  await db.execute(sql`
    CREATE TABLE sitespecific_bao_ee_contribution_rates (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      policy_id varchar NOT NULL,
      benefit_id varchar NOT NULL,
      rate numeric(10,2) NOT NULL,
      effective_ymd date NOT NULL,
      CONSTRAINT sitespecific_bao_ee_contribution_rates_policy_benefit_ymd_uq
        UNIQUE (policy_id, benefit_id, effective_ymd),
      CONSTRAINT sitespecific_bao_ee_contribution_rates_policy_id_fkey
        FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE,
      CONSTRAINT sitespecific_bao_ee_contribution_rates_benefit_id_fkey
        FOREIGN KEY (benefit_id) REFERENCES trust_benefits(id) ON DELETE CASCADE,
      CONSTRAINT sitespecific_bao_ee_contribution_rates_rate_nonnegative_chk
        CHECK (rate >= 0)
    )
  `);
  logger.info("Created BAO EE contribution rates table", { service: SERVICE });
}

const migration: Migration = {
  version: 1147,
  name: "create_ee_contribution_rates",
  description:
    "Create sitespecific_bao_ee_contribution_rates: effective-dated, exact nonnegative monthly employee contribution rates per policy and benefit. An explicit $0.00 remains distinct from missing configuration. Idempotent: creation is skipped if component schema enablement already created the table.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;