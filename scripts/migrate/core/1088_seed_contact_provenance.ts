import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1088";

/**
 * Move what `contact_phone` and `contact_postal` know about their own history
 * into `entity_metadata`, before the next migration drops the columns.
 *
 * `contact_phone.created_at` and `contact_postal.created_at` / `updated_at`
 * predate the provenance framework. Both tables are already logged, so every
 * mutation from here on files provenance by itself; what these columns hold is
 * the history of every row written BEFORE that, and it only survives if it is
 * copied across first.
 *
 * Neither table records WHO, so every seeded row keeps an unknown person —
 * the framework's honest answer for a record it met mid-life. Only the dates
 * are recoverable, and those are moved by the shared routine
 * (`storage.entityMetadataSeed.seedFromColumns`), which never moves a stamp
 * backwards, never replaces a known person with nobody, wraps its own
 * transaction, and reports zero rows written on a rerun.
 *
 * One of these dates is not decorative: the SMS reads pick a worker's number
 * by "active primary, oldest first", which used to mean
 * `contact_phone.created_at` and now means the provenance created date seeded
 * here. That is why this runs before the drop rather than alongside it — the
 * pick has to keep giving the same answer across the pair.
 */
async function up(): Promise<void> {
  const results = [
    await storage.entityMetadataSeed.seedFromColumns({
      table: "contact_phone",
      createdDateColumn: "created_at",
    }),
    await storage.entityMetadataSeed.seedFromColumns({
      table: "contact_postal",
      createdDateColumn: "created_at",
      modifiedDateColumn: "updated_at",
    }),
  ];

  for (const result of results) {
    if (!result.seeded) {
      // Already dropped (a rerun after 1089), or a schema that never had the
      // column. Stated, not fatal: the routine's own skip path.
      logger.info(`Provenance seed skipped for ${result.table}: ${result.reason}`, {
        service: SERVICE,
      });
      continue;
    }
    logger.info(`Seeded provenance for ${result.table}`, {
      service: SERVICE,
      records: result.records,
      rowsWritten: result.rowsWritten,
      skippedWithoutDate: result.skippedWithoutDate,
      skippedNotRecordId: result.skippedNotRecordId,
      heldByAnotherTable: result.heldByAnotherTable,
    });
  }
}

const migration: Migration = {
  version: 1088,
  name: "seed_contact_provenance",
  description:
    "Seed entity_metadata from contact_phone.created_at and contact_postal.created_at / updated_at, so every existing phone and address keeps its creation and change dates once those columns are dropped",
  up,
};

registerMigration(migration);

export default migration;
