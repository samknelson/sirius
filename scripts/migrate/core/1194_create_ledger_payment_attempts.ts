import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { db } from "../../../server/db";
import { sql } from "drizzle-orm";

const migration: Migration = {
  version: 1194,
  name: "create_ledger_payment_attempts",
  description: "Persist Stripe payment attempts and webhook receipts for worker self-payments.",
  async up() {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ledger_payment_attempts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
        ledger_ea_id varchar NOT NULL REFERENCES ledger_ea(id) ON DELETE RESTRICT,
        gateway_config_id varchar NOT NULL,
        payment_method_id varchar NOT NULL,
        provider_intent_ref text UNIQUE,
        idempotency_key text NOT NULL UNIQUE,
        amount numeric(10,2) NOT NULL,
        currency varchar(10) NOT NULL DEFAULT 'USD',
        status text NOT NULL DEFAULT 'requires_action',
        ledger_payment_id varchar REFERENCES ledger_payments(id) ON DELETE SET NULL,
        last_provider_event_created integer,
        failure_message text,
        metadata jsonb,
        CONSTRAINT ledger_payment_attempts_gateway_config_fkey FOREIGN KEY (gateway_config_id) REFERENCES plugin_configs_payment_gateway(id) ON DELETE RESTRICT,
        CONSTRAINT ledger_payment_attempts_payment_method_fkey FOREIGN KEY (payment_method_id) REFERENCES ledger_paymentmethods(id) ON DELETE RESTRICT,
        CONSTRAINT ledger_payment_attempts_status_check CHECK (status IN ('requires_action','processing','succeeded','failed'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ledger_payment_attempts_ledger_payment_unique ON ledger_payment_attempts(ledger_payment_id);
      CREATE INDEX IF NOT EXISTS ledger_payment_attempts_worker_idx ON ledger_payment_attempts(worker_id);
      CREATE TABLE IF NOT EXISTS ledger_payment_attempt_events (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        attempt_id varchar NOT NULL,
        provider_event_id text NOT NULL UNIQUE,
        event_type text NOT NULL,
        provider_created integer NOT NULL,
        payload jsonb,
        received_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT ledger_payment_attempt_events_attempt_fkey FOREIGN KEY (attempt_id) REFERENCES ledger_payment_attempts(id) ON DELETE CASCADE
      );
    `));
  },
};

registerMigration(migration);