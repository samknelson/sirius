import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1106";

/**
 * Repair databases that already recorded 1103/1104/1105 while still carrying
 * the old compatibility column names. This is deliberately conditional:
 * intact local columns are never replaced, and fresh databases already have
 * the correct shape from their original migrations.
 *
 * A database that has already passed the old metadata cleanup cannot recover a
 * value that was deleted with that metadata. In that case the required local
 * column is added with a default only for the unrecoverable compatibility
 * state. That fallback is a schema-completion timestamp, not recovered
 * historical provenance, and this migration never writes over an existing
 * local value.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE
      has_old boolean;
      has_new boolean;
    BEGIN
      IF to_regclass('public.snapshots') IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'captured_at'
        ) INTO has_old;
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'created_at'
        ) INTO has_new;
        IF has_old AND NOT has_new THEN
          ALTER TABLE snapshots RENAME COLUMN captured_at TO created_at;
        END IF;

        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'captured_by'
        ) INTO has_old;
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'author_id'
        ) INTO has_new;
        IF has_old AND NOT has_new THEN
          ALTER TABLE snapshots RENAME COLUMN captured_by TO author_id;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE snapshots ADD COLUMN created_at timestamp;
        END IF;
        ALTER TABLE snapshots ALTER COLUMN created_at SET DEFAULT now();
        ALTER TABLE snapshots ALTER COLUMN created_at DROP NOT NULL;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'author_id'
        ) THEN
          ALTER TABLE snapshots ADD COLUMN author_id varchar REFERENCES users(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'snapshots' AND column_name = 'author_name'
        ) THEN
          ALTER TABLE snapshots ADD COLUMN author_name text;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'snapshots'
            AND indexname = 'snapshots_entity_type_entity_id_created_at_idx'
        ) THEN
          CREATE INDEX snapshots_entity_type_entity_id_created_at_idx
            ON snapshots (entity_type, entity_id, created_at);
        END IF;
      END IF;

      IF to_regclass('public.ledger_payments') IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ledger_payments' AND column_name = 'created_at'
        ) INTO has_old;
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ledger_payments' AND column_name = 'date_created'
        ) INTO has_new;
        IF has_old AND NOT has_new THEN
          ALTER TABLE ledger_payments RENAME COLUMN created_at TO date_created;
        ELSIF NOT has_new THEN
          ALTER TABLE ledger_payments ADD COLUMN date_created timestamp;
        END IF;
        ALTER TABLE ledger_payments ALTER COLUMN date_created SET DEFAULT now();
        ALTER TABLE ledger_payments ALTER COLUMN date_created DROP NOT NULL;
      END IF;

      IF to_regclass('public.ledger_gateway_customers') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ledger_gateway_customers' AND column_name = 'created_at'
         ) THEN
        ALTER TABLE ledger_gateway_customers ADD COLUMN created_at timestamp;
        ALTER TABLE ledger_gateway_customers ALTER COLUMN created_at SET DEFAULT now();
        ALTER TABLE ledger_gateway_customers ALTER COLUMN created_at DROP NOT NULL;
      END IF;

      IF to_regclass('public.auth_identities') IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'auth_identities' AND column_name = 'created_at'
        ) THEN
          ALTER TABLE auth_identities ADD COLUMN created_at timestamp;
        END IF;
        ALTER TABLE auth_identities ALTER COLUMN created_at SET DEFAULT now();
        ALTER TABLE auth_identities ALTER COLUMN created_at DROP NOT NULL;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'auth_identities' AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE auth_identities ADD COLUMN updated_at timestamp;
        END IF;
        ALTER TABLE auth_identities ALTER COLUMN updated_at SET DEFAULT now();
        ALTER TABLE auth_identities ALTER COLUMN updated_at DROP NOT NULL;
      END IF;

      IF to_regclass('public.worker_msh') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'worker_msh' AND column_name = 'created_at'
         ) THEN
        ALTER TABLE worker_msh ADD COLUMN created_at timestamp;
        ALTER TABLE worker_msh ALTER COLUMN created_at SET DEFAULT now();
        ALTER TABLE worker_msh ALTER COLUMN created_at DROP NOT NULL;
      END IF;
    END $$;
  `);

  logger.info("Restored process-owned local provenance columns where needed", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1106,
  name: "restore_process_local_provenance",
  description:
    "Repair already-migrated process tables to the local provenance shape without overwriting intact values.",
  up,
};

registerMigration(migration);

export default migration;