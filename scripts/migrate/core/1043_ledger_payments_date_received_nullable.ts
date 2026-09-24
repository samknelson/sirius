import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Make ledger_payments.date_received nullable.
 *
 * The Drizzle schema declared date_received as NOT NULL, but every consumer of
 * the column already treats it as nullable (charge plugin context types it
 * `Date | null`, the payments list orders by it `DESC NULLS LAST`, and the
 * client guards `if (payment.dateReceived)`), and long-standing dev data holds
 * legitimate NULLs for legacy/imported payments. Rather than fabricate a
 * received date for rows that never had one, the schema is relaxed to match
 * the code's actual contract.
 *
 * Deployments whose table was bootstrapped while the schema still said NOT
 * NULL get the constraint dropped here; deployments already nullable no-op.
 *
 * Idempotent: DROP NOT NULL is a no-op when the column is already nullable.
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE ledger_payments ALTER COLUMN date_received DROP NOT NULL`,
  );
  logger.info("Ensured ledger_payments.date_received is nullable", {
    service: "migration-1043",
  });
}

const migration: Migration = {
  version: 1043,
  name: "ledger_payments_date_received_nullable",
  description:
    "Drop the NOT NULL constraint on ledger_payments.date_received so the schema matches the code's actual nullable contract and legacy payments without a received date remain representable.",
  up,
};

registerMigration(migration);

export default migration;
