import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { createEntityMetadataSeedStorage } from "../../../server/storage/system/entity-metadata-seed";
import { logger } from "../../../server/logger";

/**
 * Move what `dispatch_jobs.created_at` and `dispatches.created_at` know into
 * `entity_metadata`, before migration 1093 drops them.
 *
 * Both tables are already under storage logging, so every job and dispatch
 * saved since the provenance framework landed already has a stamp. These are
 * the ones that predate it: their only record of when they were made is the
 * bespoke column, and dropping it without seeding first would simply lose
 * that history.
 *
 * Neither table records WHO created a record, so the seeded rows carry a date
 * and an unknown person — which is the truth about them. New records get a
 * person from the logging middleware.
 *
 * Idempotent and never-downgrading: see `seedFromColumns`. Both tables belong
 * to the (optional) `dispatch` component, so on a deployment where dispatch
 * is off the seed states a skip instead of failing the boot.
 *
 * Imports the seed storage's own factory rather than the `server/storage`
 * barrel: this file is on the boot path, and the barrel drags the whole
 * storage graph in behind it.
 */
async function up(): Promise<void> {
  const seed = createEntityMetadataSeedStorage();

  for (const table of ["dispatch_jobs", "dispatches"]) {
    const result = await seed.seedFromColumns({
      table,
      createdDateColumn: "created_at",
    });

    if (!result.seeded) {
      logger.info(`Skipped seeding provenance for ${table}: ${result.reason}`, {
        service: "migration-1092",
      });
      continue;
    }

    logger.info(`Seeded provenance for ${table} from created_at`, {
      service: "migration-1092",
      records: result.records,
      rowsWritten: result.rowsWritten,
      skippedWithoutDate: result.skippedWithoutDate,
      skippedNotRecordId: result.skippedNotRecordId,
    });
  }
}

const migration: Migration = {
  version: 1092,
  name: "seed_dispatch_provenance",
  description:
    "Seed entity_metadata for dispatch_jobs and dispatches from their bespoke created_at columns, so the creation dates of records that predate the provenance framework survive the columns being dropped in migration 1093. Uses the shared seeding routine: idempotent, never moves a stamp backwards, and states a skip (rather than failing the boot) where the dispatch component is disabled and the tables are absent.",
  up,
};

registerMigration(migration);

export default migration;
