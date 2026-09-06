import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1081";

/**
 * Move what the two wizard mapping tables' own timestamp columns know into
 * `entity_metadata`, before migration 1080 drops them.
 *
 * `wizard_feed_mappings` and `wizard_employment_status_mappings` are
 * operator-editable configuration — which column of an imported file feeds
 * which field, and which of an employer's employment statuses means which of
 * ours — and both predate the provenance framework, carrying their own
 * `created_at` / `updated_at` and naming nobody. They joined the storage
 * logging framework in the same change, so from here on a mapping's history
 * is written for it; this seeds what already happened.
 *
 * Neither table records WHO, so every seeded row keeps an unknown person and
 * only its dates: that is what the columns hold, and the routine does not
 * guess.
 *
 * `wizard_report_data` is deliberately not here. Its rows are bulk output of a
 * report run, not records anyone edits, and its `created_at` stays as the
 * operational column the retention purge reads — see
 * `docs/provenance-columns.md` and the note on `wizardLoggingConfig`.
 *
 * Idempotent: the shared routine only ever makes a stamp more truthful, so a
 * second run writes nothing.
 */
async function up(): Promise<void> {
  for (const table of [
    "wizard_feed_mappings",
    "wizard_employment_status_mappings",
  ]) {
    const result = await storage.entityMetadataSeed.seedFromColumns({
      table,
      createdDateColumn: "created_at",
      modifiedDateColumn: "updated_at",
    });
    if (result.seeded) {
      logger.info("Seeded wizard mapping provenance", {
        service: SERVICE,
        table,
        records: result.records,
        rowsWritten: result.rowsWritten,
        skippedWithoutDate: result.skippedWithoutDate,
        skippedNotRecordId: result.skippedNotRecordId,
        heldByAnotherTable: result.heldByAnotherTable,
      });
    } else {
      logger.info("Skipped seeding wizard mapping provenance", {
        service: SERVICE,
        table,
        reason: result.reason,
      });
    }
  }
}

const migration: Migration = {
  version: 1081,
  name: "seed_wizard_mapping_provenance",
  description:
    "Seed entity_metadata for wizard_feed_mappings and wizard_employment_status_mappings from their own created_at / updated_at columns, before those columns are dropped. Both tables record a date and no person, so the seeded rows carry dates and an unknown actor.",
  up,
};

registerMigration(migration);

export default migration;
