import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

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
  const oldName = "ledger_stripe_paymentmethods";
  const newName = "ledger_paymentmethods";

  const oldExists = await tableExists(oldName);
  const newExists = await tableExists(newName);

  if (oldExists && !newExists) {
    // Existing rows are test-only and cannot satisfy the new NOT NULL
    // gateway_config_id, so drop them before renaming.
    await db.execute(sql`DELETE FROM ledger_stripe_paymentmethods`);
    await db.execute(sql`ALTER TABLE ledger_stripe_paymentmethods RENAME TO ledger_paymentmethods`);
    logger.info("Renamed ledger_stripe_paymentmethods to ledger_paymentmethods", {
      service: "migration-1027",
    });
  } else if (oldExists && newExists) {
    // Unexpected: both tables present (e.g. a partial prior run). The new
    // table is canonical, so drop the stale old one.
    await db.execute(sql`DROP TABLE ledger_stripe_paymentmethods`);
    logger.info("Dropped stale ledger_stripe_paymentmethods (new table already present)", {
      service: "migration-1027",
    });
  }

  if (!(await tableExists(newName))) {
    // Nothing to alter — table doesn't exist in this database.
    return;
  }

  // Add the generic gateway-agnostic settings blob.
  if (!(await columnExists(newName, "data"))) {
    await db.execute(sql`ALTER TABLE ledger_paymentmethods ADD COLUMN data jsonb DEFAULT '{}'`);
    logger.info("Added data jsonb column to ledger_paymentmethods", {
      service: "migration-1027",
    });
  }

  // Add the required gateway_config_id FK. It is NOT NULL, so clear any rows
  // first (test-only data, droppable per the task).
  if (!(await columnExists(newName, "gateway_config_id"))) {
    await db.execute(sql`DELETE FROM ledger_paymentmethods`);
    await db.execute(sql`
      ALTER TABLE ledger_paymentmethods
        ADD COLUMN gateway_config_id varchar NOT NULL
        REFERENCES plugin_configs_payment_gateway(id) ON DELETE RESTRICT
    `);
    logger.info("Added gateway_config_id FK column to ledger_paymentmethods", {
      service: "migration-1027",
    });
  }
}

const migration: Migration = {
  version: 1027,
  name: "rename_ledger_payment_methods",
  description:
    "Rename ledger_stripe_paymentmethods to ledger_paymentmethods, add generic data jsonb and required gateway_config_id FK (provider-generic payment methods)",
  up,
};

registerMigration(migration);
