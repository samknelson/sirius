import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Creates wizard_work_location_mappings: persistent per-employer mappings
 * from a file's "Work Location Name" to a target employer, used by the
 * GBHE Local 26 Hourly upload wizard (same UX as the per-employer
 * employment-status mappings). Idempotent: CREATE TABLE IF NOT EXISTS.
 */
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
  logger.info("wizard_work_location_mappings ready", { service: "migration-1047" });
}

registerMigration({
  version: 1047,
  name: "create_wizard_work_location_mappings",
  description: "Create wizard_work_location_mappings for the GBHE Local 26 Hourly wizard's work-location mapping fallback",
  up,
});
