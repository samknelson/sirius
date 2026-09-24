import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/** Existing deployments may already have this table under the older branch's migration number. */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS wizard_work_location_mappings (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      employer_id varchar NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
      source_location text NOT NULL,
      target_employer_id varchar NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT idx_wizard_wlm_employer_source UNIQUE (employer_id, source_location)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_wizard_wlm_employer ON wizard_work_location_mappings (employer_id)
  `);
  logger.info("wizard_work_location_mappings ready", { service: "migration-1111" });
}

registerMigration({
  version: 1111,
  name: "create_wizard_work_location_mappings",
  description: "Create work-location mappings for the GBHE Local 26 Hourly wizard",
  up,
});