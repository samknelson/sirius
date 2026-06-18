import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1028";

async function tableExists(name: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === 't';
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === 't';
}

async function up(): Promise<void> {
  // 1. Create the per-(entity, gateway config) provider customer mapping table.
  if (!(await tableExists("ledger_gateway_customers"))) {
    await db.execute(sql`
      CREATE TABLE ledger_gateway_customers (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type text NOT NULL,
        entity_id varchar NOT NULL,
        gateway_config_id varchar NOT NULL
          REFERENCES plugin_configs_payment_gateway(id) ON DELETE RESTRICT,
        customer_ref text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT ledger_gateway_customers_entity_gateway_unique
          UNIQUE (entity_type, entity_id, gateway_config_id)
      )
    `);
    logger.info("Created ledger_gateway_customers table", { service: SERVICE });
  }

  // 2. Drop the obsolete single-account customer column on employers. Only
  // test data ever lived here, so no data migration is required.
  if (await columnExists("employers", "stripe_customer_id")) {
    await db.execute(sql`ALTER TABLE employers DROP COLUMN stripe_customer_id`);
    logger.info("Dropped employers.stripe_customer_id column", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1028,
  name: "provider_generic_payment_methods",
  description:
    "Create ledger_gateway_customers (per-entity/per-gateway customer mapping) and drop the obsolete employers.stripe_customer_id column",
  up,
};

registerMigration(migration);
