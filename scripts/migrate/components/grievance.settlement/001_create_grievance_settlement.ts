import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance.settlement";

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
 * Create the tables owned by the grievance.settlement component:
 *
 * - options_grievance_settlement_type: standard unified-options table
 *   (name, description, sirius_id, sequence, data). The type icon is stored
 *   inside the `data` jsonb.
 * - grievance_settlements: a settlement recorded against a grievance.
 *   `grievance_id` references grievances(id) ON DELETE CASCADE (requires the
 *   grievance component to be enabled first). `type_ids` is a plain text[]
 *   multi-value reference to options_grievance_settlement_type — Postgres
 *   cannot FK array elements, so the "on delete set null" behavior for removed
 *   types is application-level, not a DB constraint. `amount` is numeric(10,2).
 *
 * Idempotent: each table is created only if absent (the enable flow creates
 * them via component schema push first).
 */
async function up(): Promise<void> {
  if (!(await tableExists("options_grievance_settlement_type"))) {
    await db.execute(sql`
      CREATE TABLE options_grievance_settlement_type (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL UNIQUE,
        description text,
        sirius_id varchar UNIQUE,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb
      )
    `);
    logger.info("Created options_grievance_settlement_type table", {
      service: "migration-grievance.settlement-001",
    });
  } else {
    logger.info("options_grievance_settlement_type table already exists, skipping", {
      service: "migration-grievance.settlement-001",
    });
  }

  if (!(await tableExists("grievance_settlements"))) {
    await db.execute(sql`
      CREATE TABLE grievance_settlements (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        sirius_id varchar UNIQUE,
        grievance_id varchar NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
        type_ids text[],
        description text,
        amount numeric(10, 2),
        data jsonb
      )
    `);
    logger.info("Created grievance_settlements table", {
      service: "migration-grievance.settlement-001",
    });
  } else {
    logger.info("grievance_settlements table already exists, skipping", {
      service: "migration-grievance.settlement-001",
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "create_grievance_settlement",
  description:
    "Create the options_grievance_settlement_type unified-options table plus the grievance_settlements table owned by the grievance.settlement component. grievance_settlements.grievance_id references grievances(id) ON DELETE CASCADE (requires the grievance component). type_ids is a text[] multi-value reference (no DB FK on array elements). amount is numeric(10,2). Idempotent: skips any table that already exists (the enable flow creates them via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
