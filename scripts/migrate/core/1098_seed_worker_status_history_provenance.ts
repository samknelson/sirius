import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1098";

/**
 * Move what the two worker status history tables' own `created_at` columns
 * know into provenance, before anything is dropped.
 *
 * `worker_msh` (member status history) and `worker_wsh` (work status history)
 * each carry two dates: `date`, the status's EFFECTIVE date, which is business
 * data; and `created_at`, when the row was entered, which is provenance and
 * belongs in `entity_metadata` like every other record's. Both tables are
 * already under storage logging, so every row written from here on gets a
 * provenance row naming the person who entered it — but the rows that already
 * exist know nothing but what their own column holds, and that has to reach
 * provenance before the column goes.
 *
 * Both tables are seeded, not just the one whose column is being dropped:
 * `worker_wsh.created_at` stays (it is the tie-break ordering key that decides
 * which of two same-date work statuses is current — see
 * `docs/provenance-columns.md`), but its records deserve the same truthful
 * creation date as everybody else's, and the seed is the only thing that can
 * give it to them.
 *
 * The seeding routine wraps its own transaction, only ever makes a stamp more
 * truthful, and reports zero rows written on a re-run, so this is idempotent.
 */
async function up(): Promise<void> {
  for (const table of ["worker_msh", "worker_wsh"]) {
    const result = await storage.entityMetadataSeed.seedFromColumns({
      table,
      createdDateColumn: "created_at",
    });

    if (!result.seeded) {
      logger.info(`Skipped seeding provenance for ${table}`, {
        service: SERVICE,
        table,
        reason: result.reason,
      });
      continue;
    }

    logger.info(`Seeded provenance for ${table}`, {
      service: SERVICE,
      table,
      records: result.records,
      rowsWritten: result.rowsWritten,
      skippedWithoutDate: result.skippedWithoutDate,
      skippedNotRecordId: result.skippedNotRecordId,
      heldByAnotherTable: result.heldByAnotherTable,
    });
  }
}

const migration: Migration = {
  version: 1098,
  name: "seed_worker_status_history_provenance",
  description:
    "Seed entity_metadata for worker_msh and worker_wsh from each table's own created_at column, so the entry dates those bespoke columns hold survive in provenance before worker_msh.created_at is dropped.",
  up,
};

registerMigration(migration);

export default migration;
