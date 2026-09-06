import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1082";

/**
 * Drop the bespoke provenance columns from the two wizard mapping tables.
 *
 * Migration 1079 moved what they know into `entity_metadata`, and both tables
 * are now wired into the storage logging framework, so a mapping's creation
 * and last change — with the person, which these columns never had — are the
 * framework's answer from here on.
 *
 * The only read either column had was the "most recently changed first"
 * ordering of a user's saved feed mappings, which now reads
 * `entity_metadata.modified_date`.
 *
 * `wizard_report_data.created_at` is untouched on purpose: it is operational,
 * not provenance (see `docs/provenance-columns.md`).
 *
 * Idempotent: every drop is IF EXISTS.
 */
async function up(): Promise<void> {
  await db.execute(sql`ALTER TABLE wizard_feed_mappings DROP COLUMN IF EXISTS created_at`);
  await db.execute(sql`ALTER TABLE wizard_feed_mappings DROP COLUMN IF EXISTS updated_at`);
  await db.execute(
    sql`ALTER TABLE wizard_employment_status_mappings DROP COLUMN IF EXISTS created_at`,
  );
  await db.execute(
    sql`ALTER TABLE wizard_employment_status_mappings DROP COLUMN IF EXISTS updated_at`,
  );

  logger.info("Dropped bespoke timestamp columns from the wizard mapping tables", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1082,
  name: "drop_wizard_mapping_timestamps",
  description:
    "Drop created_at / updated_at from wizard_feed_mappings and wizard_employment_status_mappings now that entity_metadata holds their provenance.",
  up,
};

registerMigration(migration);

export default migration;
