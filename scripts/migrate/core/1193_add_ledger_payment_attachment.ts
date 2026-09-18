import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE ledger_payments
      ADD COLUMN IF NOT EXISTS attachment_file_id varchar
  `);
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ledger_payments_attachment_file_id_files_id_fk'
      ) THEN
        ALTER TABLE ledger_payments
          ADD CONSTRAINT ledger_payments_attachment_file_id_files_id_fk
          FOREIGN KEY (attachment_file_id) REFERENCES files(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);
}

const migration: Migration = {
  version: 1193,
  name: "add_ledger_payment_attachment",
  description: "Allow individual ledger payments to reference one private image attachment.",
  up,
};

registerMigration(migration);
export default migration;