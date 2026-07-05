import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance.contract";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Create the grievance_contracts table owned by the grievance.contract
 * component. It links a grievance to a contract:
 *
 * - grievance_id references grievances(id) ON DELETE CASCADE (requires the
 *   grievance component to be enabled first — deleting a grievance removes its
 *   contract link). It is UNIQUE: a grievance links to at most one contract.
 * - contract_id references contracts(id) ON DELETE RESTRICT (requires the
 *   contract component to be enabled first — a contract that is referenced by a
 *   link cannot be deleted until the link is removed).
 * - data is a nullable jsonb payload.
 *
 * The unique on grievance_id is created as a named UNIQUE CONSTRAINT
 * (grievance_contracts_grievance_id_unique) to match Drizzle's `.unique()`
 * convention so the startup drift gate does not flag a mismatch (a UNIQUE INDEX
 * would fail the gate).
 *
 * Idempotent: the table is created only if absent (the enable flow creates it
 * via component schema push first).
 */
async function up(): Promise<void> {
  if (!(await tableExists("grievance_contracts"))) {
    await db.execute(sql`
      CREATE TABLE grievance_contracts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
        contract_id varchar NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
        data jsonb,
        CONSTRAINT grievance_contracts_grievance_id_unique UNIQUE (grievance_id)
      )
    `);
    logger.info("Created grievance_contracts table", {
      service: "migration-grievance.contract-002",
    });
  } else {
    logger.info("grievance_contracts table already exists, skipping", {
      service: "migration-grievance.contract-002",
    });
  }
}

const migration: Migration = {
  version: 2,
  name: "create_grievance_contracts",
  description:
    "Create the grievance_contracts table owned by the grievance.contract component. grievance_id references grievances(id) ON DELETE CASCADE and is UNIQUE (a grievance links to at most one contract); contract_id references contracts(id) ON DELETE RESTRICT; data is nullable jsonb. The unique on grievance_id is a named UNIQUE CONSTRAINT to match Drizzle's convention and satisfy the drift gate. Idempotent: skips the table if it already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
