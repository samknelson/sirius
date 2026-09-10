import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1107";

/**
 * Older databases may already have the restored process columns as NOT NULL.
 * Make their unknown state representable without changing any stored value.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.snapshots') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'snapshots'
             AND column_name = 'created_at'
         ) THEN
        ALTER TABLE snapshots ALTER COLUMN created_at DROP NOT NULL;
      END IF;

      IF to_regclass('public.ledger_payments') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ledger_payments'
             AND column_name = 'date_created'
         ) THEN
        ALTER TABLE ledger_payments ALTER COLUMN date_created DROP NOT NULL;
      END IF;

      IF to_regclass('public.ledger_gateway_customers') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ledger_gateway_customers'
             AND column_name = 'created_at'
         ) THEN
        ALTER TABLE ledger_gateway_customers ALTER COLUMN created_at DROP NOT NULL;
      END IF;

      IF to_regclass('public.auth_identities') IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'auth_identities'
            AND column_name = 'created_at'
        ) THEN
          ALTER TABLE auth_identities ALTER COLUMN created_at DROP NOT NULL;
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'auth_identities'
            AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE auth_identities ALTER COLUMN updated_at DROP NOT NULL;
        END IF;
      END IF;

      IF to_regclass('public.worker_msh') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'worker_msh'
             AND column_name = 'created_at'
         ) THEN
        ALTER TABLE worker_msh ALTER COLUMN created_at DROP NOT NULL;
      END IF;
    END $$;
  `);

  logger.info("Allowed unknown process provenance without rewriting values", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1182,
  name: "allow_unknown_process_provenance",
  description: "Make lost process provenance nullable without fabricating replacement dates.",
  up,
};

registerMigration(migration);

export default migration;