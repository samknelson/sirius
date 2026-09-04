import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * The `web-usage-alert-scan` cron read the usage counters and raised a crossing
 * event for the three usage-alert notifiers. Those notifiers now wake on the
 * shared ten minute tick and read the counters themselves, so the scan and its
 * plugin registration are gone — leaving its `plugin_configs` row an orphan the
 * scheduler warns about on every boot and the admin cron page shows as a dead
 * entry. Delete it (the `plugin_configs_cron` subsidiary row cascades via FK).
 *
 * Its `cron_job_runs` history is deliberately left alone: those rows are a
 * record of what actually happened and age out with the rest.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM plugin_configs
    WHERE plugin_kind = 'cron'
      AND plugin_id = 'web-usage-alert-scan'
  `);
  logger.info(`Deleted ${result.rowCount ?? 0} retired web-usage-alert-scan cron plugin_configs row(s)`, {
    service: "migration-1143",
  });
}

const migration: Migration = {
  version: 1143,
  name: "delete_web_usage_alert_scan_cron_config",
  description:
    "Delete the orphaned plugin_configs row for the retired web-usage-alert-scan cron, whose work moved onto the shared cron tick",
  up,
};

registerMigration(migration);
