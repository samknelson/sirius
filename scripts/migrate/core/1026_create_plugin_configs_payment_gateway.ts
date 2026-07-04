import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Payment-gateway subsidiary (no columns of its own yet) plus the optional
 * link from ledger accounts to a specific payment-gateway config.
 *
 * The subsidiary table exists primarily as a type-safe FK target so
 * `ledger_accounts.gateway_config_id` can reference a specific payment-gateway
 * config instead of pointing at the polymorphic `plugin_configs` base. Its `id`
 * FK to `plugin_configs` is ON DELETE CASCADE (the subsidiary dies with its
 * base config). Every payment-gateway config gets one row, created by the
 * adapter on write and by an idempotent boot-time backfill for pre-existing
 * configs, so the generic inner-joined search keeps returning them.
 *
 * `ledger_accounts.gateway_config_id` is nullable and ON DELETE SET NULL, so
 * deleting a gateway config simply unlinks any accounts that referenced it.
 * The subsidiary table is created first because the column references it.
 */
async function up(): Promise<void> {
  if (!(await tableExists("plugin_configs_payment_gateway"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_payment_gateway (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created plugin_configs_payment_gateway table", {
      service: "migration-1026",
    });
  } else {
    logger.info("plugin_configs_payment_gateway table already exists, skipping", {
      service: "migration-1026",
    });
  }

  if (!(await columnExists("ledger_accounts", "gateway_config_id"))) {
    await db.execute(sql`
      ALTER TABLE ledger_accounts
        ADD COLUMN gateway_config_id varchar
          REFERENCES plugin_configs_payment_gateway(id) ON DELETE SET NULL
    `);
    logger.info("Added ledger_accounts.gateway_config_id column", {
      service: "migration-1026",
    });
  } else {
    logger.info("ledger_accounts.gateway_config_id already exists, skipping", {
      service: "migration-1026",
    });
  }
}

const migration: Migration = {
  version: 1026,
  name: "create_plugin_configs_payment_gateway",
  description:
    "Create the payment-gateway subsidiary table (plugin_configs_payment_gateway) as a type-safe FK target, and add the optional ledger_accounts.gateway_config_id link (ON DELETE SET NULL).",
  up,
};

registerMigration(migration);

export default migration;
