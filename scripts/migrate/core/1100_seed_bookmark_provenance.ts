import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1100";

/**
 * Carry `bookmarks.created_at` into provenance before the column is dropped.
 *
 * A bookmark's creation date is not decoration: the bookmarks page and the
 * dashboard widget both order by it and show it. The table is now under
 * storage logging, so from here on `entity_metadata` records who added a
 * bookmark and when — but only for bookmarks added from here on. Every
 * bookmark that already exists knows its own date and nothing else does, so
 * it has to move before the next migration drops the column, or the whole
 * list loses its order.
 *
 * Only the date moves: the column never recorded who added the bookmark, and
 * the seeding routine does not guess. The bookmark's owner is NOT that person
 * — `user_id` says whose list it is on, not who put it there — and while
 * those are the same person today, writing it as the creator would be
 * inventing provenance from a foreign key.
 *
 * Idempotent, and safe to run after the admin backfill has already stamped
 * these records: the routine only ever makes a stamp more truthful. See
 * `docs/provenance-columns.md`.
 */
async function up(): Promise<void> {
  // Imported here rather than at module load: the storage barrel builds the
  // whole storage layer, and a migration file is loaded while that is still
  // being assembled.
  const { storage } = await import("../../../server/storage");

  const result = await storage.entityMetadataSeed.seedFromColumns({
    table: "bookmarks",
    createdDateColumn: "created_at",
  });

  if (!result.seeded) {
    logger.info(`Nothing to seed from bookmarks.created_at: ${result.reason}`, {
      service: SERVICE,
    });
    return;
  }

  logger.info("Seeded bookmark provenance from bookmarks.created_at", {
    service: SERVICE,
    records: result.records,
    rowsWritten: result.rowsWritten,
    skippedWithoutDate: result.skippedWithoutDate,
    skippedNotRecordId: result.skippedNotRecordId,
    heldByAnotherTable: result.heldByAnotherTable,
  });
}

const migration: Migration = {
  version: 1100,
  name: "seed_bookmark_provenance",
  description:
    "Seed entity_metadata rows for every existing bookmark from bookmarks.created_at, so the bookmarks page and dashboard widget keep their newest-first order and their 'bookmarked on' date once the bespoke column is dropped. Date only — the column never recorded who added the bookmark. Idempotent; uses the shared provenance seeding routine, which skips with a stated reason if the table or column is absent.",
  up,
};

registerMigration(migration);

export default migration;
