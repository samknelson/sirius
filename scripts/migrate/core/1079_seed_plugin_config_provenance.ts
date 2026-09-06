import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1079";

/**
 * Move what `plugin_configs.created_at` / `updated_at` know into provenance,
 * before the next migration drops them.
 *
 * The table is the unified home of component, cron, notifier, charge and
 * dashboard settings, and until now its two timestamp columns were the only
 * record of a configuration changing — a date with no person and no diff. The
 * storage layer logs the table now, so every change from here on is a record
 * history entry; this is the history that already happened, carried across so
 * "created" on an existing configuration keeps meaning the day it was made
 * rather than the day this ran.
 *
 * Idempotent: the shared seeding routine only ever makes a stamp more
 * truthful, and reports zero rows written on a second run. Once the columns
 * are gone it states that and writes nothing, so a re-run after the drop is a
 * stated no-op rather than a failure.
 */
async function up(): Promise<void> {
  const result = await storage.entityMetadataSeed.seedFromColumns({
    table: "plugin_configs",
    createdDateColumn: "created_at",
    modifiedDateColumn: "updated_at",
  });

  if (!result.seeded) {
    logger.info("Skipped seeding plugin_configs provenance", {
      service: SERVICE,
      reason: result.reason,
    });
    return;
  }

  logger.info("Seeded plugin_configs provenance from its own timestamp columns", {
    service: SERVICE,
    records: result.records,
    rowsWritten: result.rowsWritten,
    skippedWithoutDate: result.skippedWithoutDate,
    skippedNotRecordId: result.skippedNotRecordId,
    heldByAnotherTable: result.heldByAnotherTable,
  });
}

const migration: Migration = {
  version: 1079,
  name: "seed_plugin_config_provenance",
  description:
    "Seed entity_metadata for every plugin_configs row from the table's own created_at / updated_at columns, so the record history of configurations that already exist survives the removal of those columns in the next migration.",
  up,
};

registerMigration(migration);

export default migration;
