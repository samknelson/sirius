import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE IF EXISTS snapshots
      ADD COLUMN IF NOT EXISTS captured_at timestamp NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS captured_by varchar REFERENCES users(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS ledger_payments
      ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS ledger_paymentmethods
      ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now()
  `);
}

const migration: Migration = {
  version: 1104,
  name: "own_process_capture_provenance",
  description: "Ensure process-owned snapshot and ledger tables retain their own display provenance after metadata cleanup",
  up,
};

registerMigration(migration);

export default migration;