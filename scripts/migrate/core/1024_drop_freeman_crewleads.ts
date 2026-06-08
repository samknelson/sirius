import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Drop the old core `freeman_crewleads` table.
 *
 * The Freeman crew-leads table used to be treated as a core table (re-exported
 * through `shared/schema.ts` while `sitespecific.freeman` declared no schema
 * manifest), so the startup drift gate expected it on every deployment even
 * where Freeman was disabled. The table is now owned by the
 * `sitespecific.freeman` component and renamed to
 * `sitespecific_freeman_crewleads`, created via component schema push / the
 * per-component migration on first enable.
 *
 * This is intentionally destructive: the old table holds only test data
 * anywhere it exists. This runs as a core migration so it always executes
 * regardless of whether the component is enabled.
 *
 * Idempotent: DROP TABLE IF EXISTS.
 */
async function up(): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS freeman_crewleads`);

  logger.info("Dropped legacy freeman_crewleads table", {
    service: "migration-1024",
  });
}

const migration: Migration = {
  version: 1024,
  name: "drop_freeman_crewleads",
  description:
    "Drop the legacy core freeman_crewleads table; the renamed sitespecific_freeman_crewleads table is now owned by the sitespecific.freeman component.",
  up,
};

registerMigration(migration);

export default migration;
