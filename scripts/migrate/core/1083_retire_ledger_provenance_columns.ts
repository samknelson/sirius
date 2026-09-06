import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";
import type { ProvenanceSeedSpec } from "../../../server/storage/system/entity-metadata-seed";

const SERVICE = "migration-1083";

/**
 * The three ledger tables that kept their own creation column, and which
 * column each one kept.
 *
 * Nothing else about these tables moves: `ledger.date`, a payment's received
 * and cleared dates and a batch's dates are accounting facts — what the money
 * did and when — and stay exactly where they are. Only "when was this row
 * made", which is provenance and belongs in one place for every table, moves.
 */
const SPECS: ProvenanceSeedSpec[] = [
  { table: "ledger_payments", createdDateColumn: "date_created" },
  { table: "ledger_paymentmethods", createdDateColumn: "created_at" },
  { table: "ledger_gateway_customers", createdDateColumn: "created_at" },
];

/**
 * Move the three ledger creation columns into `entity_metadata`, then drop
 * them.
 *
 * A payment's creation date is not decoration: the payments lists show it,
 * sort by it and date-filter on it, and those reads now come from provenance.
 * So the seeding has to happen before the columns go, and in the same
 * migration — a deployment that dropped first would answer every one of those
 * questions with a blank for its entire history, and the date would be gone
 * for good.
 *
 * Order matters twice over. Within each table the seed runs first and the drop
 * second; across tables each pair completes before the next begins, so a
 * failure part-way leaves earlier tables done and later ones untouched, both
 * in states this migration can be re-run against.
 *
 * Re-running is safe and is the ordinary case on a database that has already
 * had this applied: the seed reports a stated skip once its source column is
 * gone, and the drops are `IF EXISTS`. It also tolerates a table that is not
 * there at all — the gateway-customer mapping table belongs to a component
 * that a deployment may never have switched on, and a core migration that died
 * on its absence would stop that deployment's boot.
 */
async function up(): Promise<void> {
  for (const spec of SPECS) {
    const result = await storage.entityMetadataSeed.seedFromColumns(spec);

    if (result.seeded) {
      logger.info(`Seeded provenance for ${result.table}`, {
        service: SERVICE,
        records: result.records,
        rowsWritten: result.rowsWritten,
        skippedWithoutDate: result.skippedWithoutDate,
        skippedNotRecordId: result.skippedNotRecordId,
        heldByAnotherTable: result.heldByAnotherTable,
      });
    } else {
      logger.info(`Did not seed provenance for ${result.table}`, {
        service: SERVICE,
        reason: result.reason,
      });
    }

    // Built from this file's own literals, never from anything a caller
    // supplied — the same line the seeding routine draws around identifiers.
    await db.execute(
      sql.raw(
        `ALTER TABLE IF EXISTS "${spec.table}" DROP COLUMN IF EXISTS "${spec.createdDateColumn}"`,
      ),
    );
    logger.info(`Dropped ${spec.table}.${spec.createdDateColumn}`, { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1083,
  name: "retire_ledger_provenance_columns",
  description:
    "Move ledger_payments.date_created, ledger_paymentmethods.created_at and ledger_gateway_customers.created_at into entity_metadata provenance, then drop all three. Seeds each table before dropping its column so no payment loses the date the payments lists show, sort and filter by. Idempotent and tolerant of an absent gateway-customer table.",
  up,
};

registerMigration(migration);

export default migration;
