import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { db } from "../../../server/db";
import { sql } from "drizzle-orm";

const migration: Migration = {
  version: 1201,
  name: "restore_payment_attempt_immediate_fk",
  description: "Restore immediate payment-link validation after switching posting to lock, insert, then claim.",
  async up() {
    await db.execute(sql.raw(`
      DO $$ DECLARE c record; BEGIN
        FOR c IN SELECT conname FROM pg_constraint
          WHERE conrelid = 'ledger_payment_attempts'::regclass AND contype = 'f'
          AND confrelid = 'ledger_payments'::regclass
        LOOP
          EXECUTE format('ALTER TABLE ledger_payment_attempts ALTER CONSTRAINT %I NOT DEFERRABLE', c.conname);
        END LOOP;
      END $$;
    `));
  },
};

registerMigration(migration);