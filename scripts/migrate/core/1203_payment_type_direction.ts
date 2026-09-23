import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1203,
  name: "payment_type_direction",
  description: "Default ledger payment types to credit and identify known charge types without rewriting posted ledger entries.",
  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        ALTER TABLE options_ledger_payment_type
        ADD COLUMN direction varchar(6) NOT NULL DEFAULT 'credit'
      `);
      await tx.execute(sql`
        ALTER TABLE options_ledger_payment_type
        ADD CONSTRAINT options_ledger_payment_type_direction_check
        CHECK (direction IN ('charge', 'credit'))
      `);
      // This is a configuration-only migration. Posted entries are deliberately
      // corrected separately, after the operator reviews the repair preview.
      await tx.execute(sql`
        UPDATE options_ledger_payment_type SET direction = 'charge'
        WHERE name IN ('Adjustment - Charge', 'COBRA Charge')
      `);
    });
  },
};

registerMigration(migration);
export default migration;