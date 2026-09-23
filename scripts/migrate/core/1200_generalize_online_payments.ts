import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { db } from "../../../server/db";
import { sql } from "drizzle-orm";

const migration: Migration = {
  version: 1200,
  name: "generalize_online_payments",
  description: "Preserve online attempts while adding checkout snapshots and a recoverable gateway inbox.",
  async up() {
    await db.execute(sql.raw(`
      ALTER TABLE ledger_payment_attempts
        ALTER COLUMN worker_id DROP NOT NULL,
        ALTER COLUMN payment_method_id DROP NOT NULL,
        ADD COLUMN account_id varchar,
        ADD COLUMN entity_type varchar,
        ADD COLUMN entity_id varchar,
        ADD COLUMN created_by_user_id varchar,
        ADD COLUMN save_method boolean NOT NULL DEFAULT false,
        ADD COLUMN consent jsonb,
        ADD COLUMN statement_selection jsonb,
        ADD COLUMN failure_code text,
        ADD COLUMN created_at timestamp,
        ADD COLUMN updated_at timestamp,
        ADD COLUMN completed_at timestamp;
      -- These are known relationships, not invented historical payer/consent data.
      UPDATE ledger_payment_attempts a SET account_id = e.account_id,
        entity_type = e.entity_type, entity_id = e.entity_id
        FROM ledger_ea e WHERE e.id = a.ledger_ea_id;
      ALTER TABLE ledger_payment_attempts
        ALTER COLUMN account_id SET NOT NULL,
        ALTER COLUMN entity_type SET NOT NULL,
        ALTER COLUMN entity_id SET NOT NULL,
        ADD CONSTRAINT ledger_payment_attempts_created_by_user_id_users_id_fk
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        ADD CONSTRAINT ledger_payment_attempts_account_id_ledger_accounts_id_fk
          FOREIGN KEY (account_id) REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
        DROP CONSTRAINT ledger_payment_attempts_status_check,
        ADD CONSTRAINT ledger_payment_attempts_status_check CHECK
          (status IN ('created','requires_action','processing','succeeded','failed','canceled','expired'));
      CREATE INDEX ledger_payment_attempts_ea_status_idx ON ledger_payment_attempts(ledger_ea_id,status);
      CREATE INDEX ledger_payment_attempts_payer_created_idx ON ledger_payment_attempts(created_by_user_id,created_at);
      ALTER TABLE ledger_payment_attempt_events
        ALTER COLUMN attempt_id DROP NOT NULL,
        ALTER COLUMN provider_created DROP NOT NULL,
        ADD COLUMN gateway_config_id varchar,
        ADD COLUMN processed_at timestamp,
        ADD COLUMN error text;
      UPDATE ledger_payment_attempt_events e SET gateway_config_id = a.gateway_config_id
        FROM ledger_payment_attempts a WHERE a.id = e.attempt_id;
      -- Receipt is not proof that posting completed: keep legacy processed_at unknown.
      ALTER TABLE ledger_payment_attempt_events
        ALTER COLUMN gateway_config_id SET NOT NULL,
        DROP CONSTRAINT ledger_payment_attempt_events_attempt_fkey,
        ADD CONSTRAINT ledger_payment_attempt_events_attempt_fkey
          FOREIGN KEY (attempt_id) REFERENCES ledger_payment_attempts(id) ON DELETE RESTRICT,
        ADD CONSTRAINT ledger_payment_attempt_events_gateway_fkey
          FOREIGN KEY (gateway_config_id) REFERENCES plugin_configs_payment_gateway(id) ON DELETE RESTRICT;
      -- Accommodate both the original inline unique name and the schema name.
      ALTER TABLE ledger_payment_attempt_events
        DROP CONSTRAINT IF EXISTS ledger_payment_attempt_events_provider_event_id_key,
        DROP CONSTRAINT IF EXISTS ledger_payment_attempt_events_provider_event_unique;
      ALTER TABLE ledger_payment_attempt_events ADD CONSTRAINT ledger_payment_attempt_events_provider_event_unique
        UNIQUE(gateway_config_id,provider_event_id);
      CREATE INDEX ledger_payment_attempt_events_pending_idx ON ledger_payment_attempt_events(processed_at,received_at);

      ALTER TABLE ledger_paymentmethods ADD COLUMN provider_method_ref text, ADD COLUMN consent jsonb;
      -- Duplicate legacy rows must keep their IDs (attempt FKs may name any of them).
      -- Assign the canonical identity once, retaining payment_method on every row.
      WITH ranked AS (
        SELECT id, payment_method, row_number() OVER (PARTITION BY gateway_config_id,payment_method ORDER BY id) AS n
        FROM ledger_paymentmethods WHERE payment_method <> ''
      )
      UPDATE ledger_paymentmethods m SET provider_method_ref = r.payment_method
        FROM ranked r WHERE m.id = r.id AND r.n = 1;
      ALTER TABLE ledger_paymentmethods ADD CONSTRAINT ledger_paymentmethods_gateway_provider_unique
        UNIQUE(gateway_config_id,provider_method_ref);

      DO $$ DECLARE c record; BEGIN
        FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'ledger'::regclass
          AND contype = 'f' AND confrelid = 'ledger_ea'::regclass
        LOOP EXECUTE format('ALTER TABLE ledger DROP CONSTRAINT %I', c.conname); END LOOP;
      END $$;
      ALTER TABLE ledger ADD CONSTRAINT ledger_ea_id_ledger_ea_id_fk
        FOREIGN KEY(ea_id) REFERENCES ledger_ea(id) ON DELETE RESTRICT;
      INSERT INTO options_ledger_payment_type(id,name,currency_code,category,sequence)
        VALUES ('online-card','Online – Card','USD','financial',0),
               ('online-bank-ach','Online – Bank (ACH)','USD','financial',0)
        ON CONFLICT(id) DO NOTHING;
    `));
  },
};

registerMigration(migration);