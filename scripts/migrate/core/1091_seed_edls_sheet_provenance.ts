import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1091";

/**
 * Move what `edls_sheets.created_by` knows into provenance, before the column
 * is dropped (per-component migration `edls:006`).
 *
 * `created_by` holds the user who made the sheet — the framework's question,
 * answered a second time by a column. `entity_metadata` is where that answer
 * lives now, so the person has to reach it before the column goes or the
 * attribution is simply lost.
 *
 * THE DATE. The sheet table has no creation date at all: `changed` is its
 * last-save watermark, refreshed on every save. That is the earliest date this
 * table can honestly claim for a sheet's creation — an upper bound, the same
 * kind of claim the framework's own backfill makes when it meets a record
 * mid-life — and the seeding routine will not invent one, so it is what gets
 * named. Nothing is lost by naming it: the routine only ever makes a stamp
 * more truthful, so a sheet whose real creation the framework already observed
 * keeps that earlier date and its recorded creator.
 *
 * Idempotent, and safe where the `edls` component is off: the routine states
 * that the table (or the column) is not there and writes nothing rather than
 * failing the boot of a deployment that does not run EDLS.
 */
async function up(): Promise<void> {
  const result = await storage.entityMetadataSeed.seedFromColumns({
    table: "edls_sheets",
    createdDateColumn: "changed",
    createdByColumn: "created_by",
  });

  if (!result.seeded) {
    logger.info(`Skipped seeding EDLS sheet provenance: ${result.reason}`, {
      service: SERVICE,
    });
    return;
  }

  logger.info("Seeded EDLS sheet provenance from created_by", {
    service: SERVICE,
    records: result.records,
    rowsWritten: result.rowsWritten,
    skippedWithoutDate: result.skippedWithoutDate,
    skippedNotRecordId: result.skippedNotRecordId,
    heldByAnotherTable: result.heldByAnotherTable,
  });
}

const migration: Migration = {
  version: 1091,
  name: "seed_edls_sheet_provenance",
  description:
    "Seed entity_metadata for edls_sheets from the table's own created_by column, naming its `changed` watermark as the creation date (the earliest date the table can honestly claim), so the sheet creator survives dropping created_by. Uses the shared seeding routine: idempotent, only ever makes a stamp more truthful, and skips with a stated reason where the edls component is off and the table is absent.",
  up,
};

registerMigration(migration);

export default migration;
