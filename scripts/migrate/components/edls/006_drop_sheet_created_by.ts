import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "edls";

/**
 * Drop `edls_sheets.created_by`. Who made a sheet is provenance, and
 * provenance lives in `entity_metadata` (see `docs/provenance-columns.md`);
 * the column was a second, partial answer to the same question.
 *
 * What it knew is already in provenance by the time this runs: core migration
 * 1079 seeds it, and core migrations run before per-component ones at boot.
 * On a deployment that enables `edls` later, migration 002 of this series adds
 * the column to a table that has never held a sheet and this one takes it back
 * off again — the series converges either way.
 *
 * The sheet's `changed` column stays: it is a change watermark that drives
 * export filtering, passport export ordering and a notifier, not provenance.
 *
 * Idempotent: DROP COLUMN IF EXISTS is a no-op once the column is gone.
 */
async function up(): Promise<void> {
  await db.execute(sql`ALTER TABLE edls_sheets DROP COLUMN IF EXISTS created_by`);
  logger.info("Dropped created_by column from edls_sheets", {
    service: "migration-edls-006",
  });
}

const migration: Migration = {
  version: 6,
  name: "drop_sheet_created_by",
  description:
    "Drop the bespoke created_by column from edls_sheets; the sheet's creator is read from entity_metadata, seeded by core migration 1079. The `changed` watermark is unaffected. Idempotent via DROP COLUMN IF EXISTS.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
