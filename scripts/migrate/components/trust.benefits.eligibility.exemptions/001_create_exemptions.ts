import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.benefits.eligibility.exemptions";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'trust_benefit_eligibility_exemptions'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("trust_benefit_eligibility_exemptions table already exists, skipping creation", {
      service: "migration-trust.benefits.eligibility.exemptions-001",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE trust_benefit_eligibility_exemptions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      subscriber_worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      eligibility_plugins varchar[],
      start_ymd date NOT NULL,
      end_ymd date,
      description text,
      data jsonb
    )
  `);

  logger.info("Created trust_benefit_eligibility_exemptions table", {
    service: "migration-trust.benefits.eligibility.exemptions-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_trust_benefit_eligibility_exemptions",
  description: "Create the trust_benefit_eligibility_exemptions table owned by the trust.benefits.eligibility.exemptions component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
