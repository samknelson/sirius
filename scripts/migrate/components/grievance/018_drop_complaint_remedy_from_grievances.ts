import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

/**
 * Drop the legacy free-text `complaint` and `remedy` columns from the
 * grievances table. These have been replaced by the ordered child tables
 * grievance_complaints and grievance_remedies (migrations 016/017).
 *
 * There is no data migration: grievance data is test-only at this point.
 *
 * Idempotent: DROP COLUMN IF EXISTS is a no-op when the column is already
 * gone, so the migration converges on re-run.
 */
async function up(): Promise<void> {
  await db.execute(sql`ALTER TABLE grievances DROP COLUMN IF EXISTS complaint`);
  await db.execute(sql`ALTER TABLE grievances DROP COLUMN IF EXISTS remedy`);

  logger.info("Dropped complaint and remedy columns from grievances", {
    service: "migration-grievance-018",
  });
}

const migration: Migration = {
  version: 18,
  name: "drop_complaint_remedy_from_grievances",
  description:
    "Drop the legacy free-text complaint and remedy columns from grievances; they are replaced by the grievance_complaints and grievance_remedies child tables. No data migration (test data only). Idempotent via DROP COLUMN IF EXISTS.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
