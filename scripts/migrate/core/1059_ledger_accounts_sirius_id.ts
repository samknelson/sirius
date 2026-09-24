import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function constraintExists(table: string, constraint: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ${table}::regclass AND conname = ${constraint}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Add an optional unique `sirius_id` column to ledger_accounts.
 *
 * - `sirius_id`: nullable varchar; multiple NULLs are allowed, non-null
 *   values must be unique. Uniqueness is a NAMED UNIQUE CONSTRAINT (not a
 *   unique index) so the reflected DDL matches the Drizzle `.unique()`
 *   declaration and the startup drift gate stays quiet.
 *
 * Idempotent: skips the column/constraint if it already exists.
 */
async function up(): Promise<void> {
  if (!(await columnExists("ledger_accounts", "sirius_id"))) {
    await db.execute(sql`
      ALTER TABLE ledger_accounts ADD COLUMN sirius_id varchar
    `);
    logger.info("Added sirius_id column to ledger_accounts", {
      service: "migration-1059",
    });
  } else {
    logger.info("ledger_accounts.sirius_id already exists, skipping", {
      service: "migration-1059",
    });
  }

  if (!(await constraintExists("ledger_accounts", "ledger_accounts_sirius_id_unique"))) {
    await db.execute(sql`
      ALTER TABLE ledger_accounts
      ADD CONSTRAINT ledger_accounts_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint ledger_accounts_sirius_id_unique", {
      service: "migration-1059",
    });
  } else {
    logger.info("ledger_accounts_sirius_id_unique already exists, skipping", {
      service: "migration-1059",
    });
  }
}

const migration: Migration = {
  version: 1059,
  name: "ledger_accounts_sirius_id",
  description:
    "Add optional unique sirius_id column to ledger_accounts. Nullable; non-null values unique via named constraint ledger_accounts_sirius_id_unique. Idempotent.",
  up,
};

registerMigration(migration);
