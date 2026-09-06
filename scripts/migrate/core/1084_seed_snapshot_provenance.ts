import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1084";

/**
 * Move what `snapshots` knows about its own captures into provenance.
 *
 * The table kept a bespoke triple — `created_at`, `author_id` and a frozen
 * copy of the author's name — for a question `entity_metadata` already answers
 * for every logged table at once. The next migration in the series drops those
 * columns, so whatever history they hold has to reach provenance first.
 *
 * Two things this deliberately does not do:
 *
 *  - **`author_name` is not seeded.** It is a denormalised copy of a name the
 *    users table holds, frozen at capture; provenance names the PERSON, and
 *    the reads resolve their current name. A frozen name whose account is gone
 *    is not recoverable as a person, and inventing one would be a guess.
 *  - **An authorless snapshot stays authorless.** Snapshots are also captured
 *    by system paths with no signed-in user, so "nobody" is a real and
 *    expected answer, not missing data. The shared seeding routine reads the
 *    person column THROUGH the users table and leaves an unknown one unknown.
 *
 * Idempotent, and it only ever makes a stamp more truthful: see
 * `server/storage/system/entity-metadata-seed.ts`.
 */
async function up(): Promise<void> {
  const result = await storage.entityMetadataSeed.seedFromColumns({
    table: "snapshots",
    createdDateColumn: "created_at",
    createdByColumn: "author_id",
  });

  if (!result.seeded) {
    logger.info("Snapshot provenance not seeded", {
      service: SERVICE,
      reason: result.reason,
    });
    return;
  }

  logger.info("Seeded snapshot provenance from the table's own columns", {
    service: SERVICE,
    records: result.records,
    rowsWritten: result.rowsWritten,
    skippedWithoutDate: result.skippedWithoutDate,
    skippedNotRecordId: result.skippedNotRecordId,
    heldByAnotherTable: result.heldByAnotherTable,
  });
}

const migration: Migration = {
  version: 1084,
  name: "seed_snapshot_provenance",
  description:
    "Seed entity_metadata for snapshots from the table's own created_at/author_id columns, leaving a system capture authorless",
  up,
};

registerMigration(migration);
