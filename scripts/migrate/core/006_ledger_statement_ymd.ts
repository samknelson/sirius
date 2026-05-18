import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='ledger'
    ) AS exists
  `);
  const hasTable = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (!hasTable) {
    logger.info("ledger table does not exist; ledger component not enabled, skipping", {
      service: "migration-006",
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_name = 'ledger' AND column_name = 'statement_ymd'
  `);

  const existingType = colCheck.rows[0]?.data_type as string | undefined;

  if (!existingType) {
    await db.execute(sql`
      ALTER TABLE ledger ADD COLUMN statement_ymd date
    `);
    logger.info("Added ledger.statement_ymd as date column", { service: "migration-006" });
  } else if (existingType === "character varying" || existingType === "text") {
    await db.execute(sql`
      ALTER TABLE ledger
      ALTER COLUMN statement_ymd TYPE date USING statement_ymd::date
    `);
    logger.info("Converted ledger.statement_ymd from varchar to date", { service: "migration-006" });
  } else if (existingType === "date") {
    logger.info("ledger.statement_ymd already date, skipping type change", { service: "migration-006" });
  } else {
    throw new Error(`Unexpected data_type for ledger.statement_ymd: ${existingType}`);
  }

  await db.execute(sql`
    UPDATE ledger
    SET statement_ymd = date::date
    WHERE statement_ymd IS NULL AND date IS NOT NULL
  `);

  const nullCheck = await db.execute(sql`
    SELECT count(*)::int AS n FROM ledger WHERE statement_ymd IS NULL
  `);
  const remainingNulls = (nullCheck.rows[0]?.n as number | undefined) ?? 0;
  if (remainingNulls > 0) {
    throw new Error(
      `Cannot enforce NOT NULL on ledger.statement_ymd: ${remainingNulls} rows have NULL statement_ymd and NULL date; resolve manually before re-running migration 006.`,
    );
  }

  await db.execute(sql`
    ALTER TABLE ledger ALTER COLUMN statement_ymd SET NOT NULL
  `);

  logger.info("ledger.statement_ymd migration complete", { service: "migration-006" });
}

const migration: Migration = {
  version: 6,
  name: "ledger_statement_ymd_to_date",
  description: "Convert ledger.statement_ymd from varchar(10) to date; idempotent for absent/varchar/date starting states.",
  up,
};

registerMigration(migration);
