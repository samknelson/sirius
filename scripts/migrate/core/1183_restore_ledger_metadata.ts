import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1108";

/**
 * Restore metadata ownership for the maintained ledger tables after the
 * earlier process-table cleanup. The local payment timestamps are the only
 * trustworthy historical source for those two tables. Accounts and batches
 * have no local provenance column, so their baseline rows intentionally keep
 * both dates null.
 */
async function up(): Promise<void> {
  const payment = await storage.entityMetadataSeed.seedFromColumns({
    table: "ledger_payments",
    createdDateColumn: "date_created",
  });
  const paymentMethod = await storage.entityMetadataSeed.seedFromColumns({
    table: "ledger_paymentmethods",
    createdDateColumn: "created_at",
  });

  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.ledger_payments') IS NOT NULL THEN
        INSERT INTO entity_metadata (context_id, entity_id, created_date, modified_date)
        SELECT 'ledger_payments', id, NULL, NULL
        FROM ledger_payments
        WHERE id IS NOT NULL
        ON CONFLICT (entity_id) DO NOTHING;
      END IF;

      IF to_regclass('public.ledger_paymentmethods') IS NOT NULL THEN
        INSERT INTO entity_metadata (context_id, entity_id, created_date, modified_date)
        SELECT 'ledger_paymentmethods', id, NULL, NULL
        FROM ledger_paymentmethods
        WHERE id IS NOT NULL
        ON CONFLICT (entity_id) DO NOTHING;
      END IF;

      IF to_regclass('public.ledger_accounts') IS NOT NULL THEN
        INSERT INTO entity_metadata (context_id, entity_id, created_date, modified_date)
        SELECT 'ledger_accounts', id, NULL, NULL
        FROM ledger_accounts
        WHERE id IS NOT NULL
        ON CONFLICT (entity_id) DO NOTHING;
      END IF;

      IF to_regclass('public.ledger_payment_batches') IS NOT NULL THEN
        INSERT INTO entity_metadata (context_id, entity_id, created_date, modified_date)
        SELECT 'ledger_payment_batches', id, NULL, NULL
        FROM ledger_payment_batches
        WHERE id IS NOT NULL
        ON CONFLICT (entity_id) DO NOTHING;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF to_regclass('public.ledger_payments') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'ledger_payments'
             AND column_name = 'date_created'
         ) THEN
        ALTER TABLE ledger_payments DROP COLUMN date_created;
      END IF;

      IF to_regclass('public.ledger_paymentmethods') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'ledger_paymentmethods'
             AND column_name = 'created_at'
         ) THEN
        ALTER TABLE ledger_paymentmethods DROP COLUMN created_at;
      END IF;
    END $$;
  `);

  logger.info("Restored maintained ledger metadata coverage", {
    service: SERVICE,
    paymentSeed: payment,
    paymentMethodSeed: paymentMethod,
    baselineContexts: ["ledger_accounts", "ledger_payment_batches"],
  });
}

const migration: Migration = {
  version: 1183,
  name: "restore_ledger_metadata",
  description:
    "Seed maintained ledger record history, preserve payment and payment-method dates, and retire their local provenance columns.",
  up,
};

registerMigration(migration);

export default migration;