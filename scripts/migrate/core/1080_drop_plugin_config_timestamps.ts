import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1080";

/**
 * Retire `plugin_configs.created_at` / `updated_at`.
 *
 * They answered "this configuration changed" and nothing more — not what
 * changed and not who changed it — which is the wrong question for the table
 * that now holds component, cron, notifier, charge and dashboard settings.
 * `entity_metadata` (seeded from these very columns by migration 1079) plus
 * the audit log answer both.
 *
 * Runs after the seed, and `IF EXISTS` keeps a re-run — or a deployment
 * baselined past this point — a no-op.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE plugin_configs
      DROP COLUMN IF EXISTS created_at,
      DROP COLUMN IF EXISTS updated_at
  `);
  logger.info("Dropped plugin_configs.created_at and plugin_configs.updated_at", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1080,
  name: "drop_plugin_config_timestamps",
  description:
    "Drop plugin_configs.created_at and plugin_configs.updated_at now that the table is under storage logging and its provenance lives in entity_metadata.",
  up,
};

registerMigration(migration);

export default migration;
