import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * These three cron handlers are no longer registered. The worker_ban_active
 * denorm plugin repairs date-window flips via denorm_backfill + denorm_stale,
 * then emits WORKER_BAN_DENORM_FLIPPED to refresh dispatch ban eligibility
 * facts. Ban edits also refresh those facts through WORKER_BAN_SAVED.
 *
 * Remove only their cron configs (the subsidiary schedule rows cascade).
 * Historical cron_job_runs remain available until normal retention removes
 * them. The singleton seeder only creates configs for registered plugins, so
 * these retired names will not be recreated on the next boot.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM plugin_configs
    WHERE plugin_kind = 'cron'
      AND plugin_id IN (
        'sync-ban-active-status',
        'sweep-expired-ban-elig',
        'worker-ban-active-scan'
      )
  `);
  logger.info("Retired legacy ban cron configurations", {
    service: "migration-1114",
    deletedCount: result.rowCount ?? 0,
  });
}

registerMigration({
  version: 1114,
  name: "retire_legacy_ban_cron_configs",
  description:
    "Remove three orphaned ban maintenance cron configs superseded by the denorm backfill/stale sweep and ban change events",
  up,
});