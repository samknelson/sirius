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
 * Create the grievance_contract_sections table owned by the
 * grievance.contract component. It links a grievance to a contract section:
 *
 * - grievance_id references grievances(id) ON DELETE CASCADE (requires the
 *   grievance component to be enabled first — deleting a grievance removes its
 *   section links).
 * - section_id references contract_sections(id) ON DELETE RESTRICT (requires
 *   the contract component to be enabled first — a contract section that is
 *   referenced by a link cannot be deleted until the link is removed).
 * - sequence is an integer ordering column (NOT NULL DEFAULT 0).
 * - data is a nullable jsonb payload.
 *
 * Idempotent: the table is created only if absent (the enable flow creates it
 * via component schema push first).
 */
async function up(): Promise<void> {
  if (!(await tableExists("grievance_contract_sections"))) {
    await db.execute(sql`
      CREATE TABLE grievance_contract_sections (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
        section_id varchar NOT NULL REFERENCES contract_sections(id) ON DELETE RESTRICT,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb
      )
    `);
    logger.info("Created grievance_contract_sections table", {
      service: "migration-grievance.contract-001",
    });
  } else {
    logger.info("grievance_contract_sections table already exists, skipping", {
      service: "migration-grievance.contract-001",
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "create_grievance_contract_sections",
  description:
    "Create the grievance_contract_sections table owned by the grievance.contract component. grievance_id references grievances(id) ON DELETE CASCADE (requires the grievance component); section_id references contract_sections(id) ON DELETE RESTRICT (requires the contract component). sequence is integer NOT NULL DEFAULT 0; data is nullable jsonb. Idempotent: skips the table if it already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
