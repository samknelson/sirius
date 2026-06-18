import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "trust.benefits.eligibility.exemptions";

async function up(): Promise<void> {
  // Add the required benefit reference (nullable first so the ALTER succeeds
  // even when rows already exist).
  await db.execute(sql`
    ALTER TABLE trust_benefit_eligibility_exemptions
    ADD COLUMN IF NOT EXISTS benefit_id varchar REFERENCES trust_benefits(id) ON DELETE CASCADE
  `);

  // There is no sensible default benefit, and an exemption with no checks is
  // no longer meaningful. Remove any pre-existing rows that cannot satisfy the
  // new NOT NULL constraints before enforcing them. Idempotent: a no-op once
  // every row has a benefit and at least one check.
  await db.execute(sql`
    DELETE FROM trust_benefit_eligibility_exemptions
    WHERE benefit_id IS NULL
       OR eligibility_plugins IS NULL
       OR cardinality(eligibility_plugins) = 0
  `);

  await db.execute(sql`
    ALTER TABLE trust_benefit_eligibility_exemptions
    ALTER COLUMN benefit_id SET NOT NULL
  `);

  await db.execute(sql`
    ALTER TABLE trust_benefit_eligibility_exemptions
    ALTER COLUMN eligibility_plugins SET NOT NULL
  `);

  logger.info("Added required benefit_id and enforced NOT NULL on eligibility_plugins", {
    service: "migration-trust.benefits.eligibility.exemptions-002",
  });
}

const migration: Migration = {
  version: 2,
  name: "require_benefit_and_plugins",
  description:
    "Add a required benefit_id reference to trust_benefits and make eligibility_plugins NOT NULL. Deletes pre-existing rows that cannot satisfy the new constraints (no benefit or no checks). Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
