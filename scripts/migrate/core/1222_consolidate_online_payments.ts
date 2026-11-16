import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

/**
 * Pre-release cutover. The owner explicitly authorized discarding all legacy
 * online test payments and their evidence; this is NOT a production backfill.
 * No vendors, posting hooks, or replacement tables are involved.
 */
const migration: Migration = {
  version: 1222,
  name: "consolidate_online_payments",
  description: "Discard pre-release online test payments and move checkout state onto ledger payments.",
  async up() {
    await db.transaction(async tx => {
      await tx.execute(sql.raw(`
        SET LOCAL lock_timeout = '15s';
        LOCK TABLE ledger_payments, ledger IN ACCESS EXCLUSIVE MODE;
        DO $$ BEGIN
          IF to_regclass('ledger_payment_attempts') IS NOT NULL THEN
            LOCK TABLE ledger_payment_attempts, ledger_payment_attempt_events IN ACCESS EXCLUSIVE MODE;
            -- Refuse ambiguous links rather than deleting unrelated payments.
            IF EXISTS (
              SELECT 1 FROM ledger_payment_attempts a JOIN ledger_payments p ON p.id = a.ledger_payment_id
              WHERE p.ledger_ea_id <> a.ledger_ea_id OR p.amount <> a.amount
                OR p.details->>'paymentAttemptId' IS DISTINCT FROM a.id
            ) THEN
              RAISE EXCEPTION 'Online payment cutover refused: inconsistent legacy payment links; inspect before deleting';
            END IF;
            DELETE FROM ledger l WHERE
              (l.reference_type = 'payment' AND l.reference_id IN
                (SELECT ledger_payment_id FROM ledger_payment_attempts WHERE ledger_payment_id IS NOT NULL))
              OR (l.charge_plugin = 'checkout-credit-transfer' AND l.reference_id IN
                (SELECT id FROM ledger_payment_attempts));
            IF to_regclass('ledger_payment_batch_assignments') IS NOT NULL THEN
              DELETE FROM ledger_payment_batch_assignments WHERE payment_id IN
                (SELECT ledger_payment_id FROM ledger_payment_attempts WHERE ledger_payment_id IS NOT NULL);
            END IF;
            DELETE FROM entity_metadata WHERE context_id = 'ledger_payments' AND entity_id IN
              (SELECT ledger_payment_id FROM ledger_payment_attempts WHERE ledger_payment_id IS NOT NULL);
            DELETE FROM ledger_payment_attempt_events;
            -- Drop references before removing the linked test payments.
            ALTER TABLE ledger_payment_attempts DROP COLUMN ledger_payment_id;
            DELETE FROM ledger_payments WHERE details->>'paymentAttemptId' IN (SELECT id FROM ledger_payment_attempts);
            DROP TABLE ledger_payment_attempt_events;
            DROP TABLE ledger_payment_attempts;
          END IF;
        END $$;
        ALTER TABLE ledger_payments
          ADD COLUMN IF NOT EXISTS checkout_state text,
          ADD COLUMN IF NOT EXISTS checkout_key text,
          ADD COLUMN IF NOT EXISTS checkout_provider_ref text,
          ADD COLUMN IF NOT EXISTS checkout_gateway_id varchar,
          ADD COLUMN IF NOT EXISTS checkout_account_id varchar REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
          ADD COLUMN IF NOT EXISTS checkout_worker_id varchar REFERENCES workers(id) ON DELETE RESTRICT,
          ADD COLUMN IF NOT EXISTS checkout_creator_id varchar REFERENCES users(id) ON DELETE RESTRICT,
          ADD COLUMN IF NOT EXISTS checkout_method_id varchar,
          ADD COLUMN IF NOT EXISTS checkout_currency varchar(10),
          ADD COLUMN IF NOT EXISTS checkout_data jsonb,
          ADD COLUMN IF NOT EXISTS checkout_created_at timestamp,
          ADD COLUMN IF NOT EXISTS checkout_updated_at timestamp;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_payments_checkout_gateway_fkey') THEN
            ALTER TABLE ledger_payments ADD CONSTRAINT ledger_payments_checkout_gateway_fkey
              FOREIGN KEY (checkout_gateway_id) REFERENCES plugin_configs_wc_vendors(id) ON DELETE RESTRICT;
            ALTER TABLE ledger_payments ADD CONSTRAINT ledger_payments_checkout_method_fkey
              FOREIGN KEY (checkout_method_id) REFERENCES ledger_paymentmethods(id) ON DELETE RESTRICT;
            ALTER TABLE ledger_payments ADD CONSTRAINT ledger_payments_checkout_key_unique UNIQUE (checkout_key);
            ALTER TABLE ledger_payments ADD CONSTRAINT ledger_payments_checkout_provider_unique UNIQUE (checkout_gateway_id, checkout_provider_ref);
            ALTER TABLE ledger_payments ADD CONSTRAINT ledger_payments_checkout_state_check CHECK
              (checkout_state IS NULL OR checkout_state IN ('created','requires_action','processing','succeeded','failed','canceled','expired'));
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS ledger_payments_checkout_recovery_idx ON ledger_payments(checkout_updated_at,id);
        CREATE INDEX IF NOT EXISTS ledger_payments_checkout_ea_idx ON ledger_payments(ledger_ea_id,checkout_state);
      `));
    });
  },
};
registerMigration(migration);
export default migration;
