import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'ledger'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("Ledger table already exists, skipping creation", {
      service: "migration-002"
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE ledger (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      charge_plugin varchar NOT NULL,
      charge_plugin_key varchar NOT NULL,
      charge_plugin_config_id varchar,
      amount numeric(10, 2) NOT NULL,
      ea_id varchar NOT NULL REFERENCES ledger_ea(id) ON DELETE CASCADE,
      reference_type varchar,
      reference_id varchar,
      date timestamp,
      memo text,
      data jsonb,
      CONSTRAINT ledger_charge_plugin_charge_plugin_key_unique UNIQUE (charge_plugin, charge_plugin_key)
    )
  `);

  logger.info("Created ledger table", {
    service: "migration-002"
  });
}

const migration: Migration = {
  version: 2,
  name: "create_ledger_table",
  description: "Create the ledger table if it does not exist (required for dues allocation and charge plugins)",
  up
};

registerMigration(migration);

export default migration;
