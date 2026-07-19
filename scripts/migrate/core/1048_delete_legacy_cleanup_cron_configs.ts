import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * The five legacy cleanup cron jobs were consolidated into data-retention
 * plugins swept by the single `data-retention` cron. Their plugin registrations
 * are gone, so their `plugin_configs` rows are orphans: the scheduler warns
 * "No plugin registered" and the admin page shows dead entries. Delete them
 * (the `plugin_configs_cron` subsidiary rows cascade via FK).
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM plugin_configs
    WHERE plugin_kind = 'cron'
      AND plugin_id IN (
        'delete-expired-hfe',
        'delete-expired-reports',
        'delete-expired-flood-events',
        'dispatch-eba-cleanup',
        'delete-old-cron-logs'
      )
  `);
  logger.info(`Deleted ${result.rowCount ?? 0} legacy cleanup cron plugin_configs rows`, {
    service: "migration-1048",
  });
}

const migration: Migration = {
  version: 1048,
  name: "delete_legacy_cleanup_cron_configs",
  description:
    "Delete orphaned plugin_configs rows for the five legacy cleanup cron jobs consolidated into the data-retention sweep",
  up,
};

registerMigration(migration);
