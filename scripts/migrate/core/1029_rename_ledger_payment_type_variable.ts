import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const oldName = "ledger_stripe_payment_type";
  const newName = "ledger_payment_type";

  // Rename the persisted default-payment-type setting to a provider-neutral
  // name, preserving the operator's configured value. Idempotent:
  //   - no-op when the old row is absent (fresh DB, or already renamed)
  //   - never clobbers an already-present new-named row (partial prior run)
  const res = await db.execute(sql`
    UPDATE variables
       SET name = ${newName}
     WHERE name = ${oldName}
       AND NOT EXISTS (
         SELECT 1 FROM variables WHERE name = ${newName}
       )
  `);

  if (res.rowCount && res.rowCount > 0) {
    logger.info("Renamed variable ledger_stripe_payment_type to ledger_payment_type", {
      service: "migration-1029",
    });
  }
}

const migration: Migration = {
  version: 1029,
  name: "rename_ledger_payment_type_variable",
  description:
    "Rename the ledger_stripe_payment_type variable to the provider-neutral ledger_payment_type, preserving the configured default payment type",
  up,
};

registerMigration(migration);
