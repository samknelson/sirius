import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Permanent lookup index for per-account statement-month evaluations.
 *
 * The EE Contributions eligibility rule filters ledger entries by ea_id and
 * groups them by statement_ymd. The charge-plugin unique constraint leads with
 * neither column, so without this index each worker evaluation scans ledger.
 *
 * Plain CREATE INDEX is intentional: the migration runner is non-transactional
 * and IF NOT EXISTS makes this safe for a deployment where the index was
 * already created manually.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ledger_ea_id_statement_ymd_idx
      ON ledger (ea_id, statement_ymd)
  `);

  logger.info(
    "Ensured ledger_ea_id_statement_ymd_idx ON ledger (ea_id, statement_ymd)",
    { service: "migration-1186" },
  );
}

const migration: Migration = {
  version: 1186,
  name: "ledger_ea_statement_ymd_index",
  description:
    "Create ledger_ea_id_statement_ymd_idx ON ledger (ea_id, statement_ymd) so per-account statement-month evaluations avoid full scans.",
  up,
};

registerMigration(migration);

export default migration;