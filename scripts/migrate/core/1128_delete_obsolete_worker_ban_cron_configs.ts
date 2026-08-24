import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Worker-ban activity is now maintained by the worker_ban_active denorm plugin
 * and the standard denorm stale sweep. Remove the two retired cron configs so
 * the scheduler and admin UI do not retain dead jobs.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    DELETE FROM plugin_configs
    WHERE plugin_kind = 'cron'
      AND plugin_id IN (
        'worker-ban-active-scan',
        'sweep-expired-ban-elig'
      )
  `);

  logger.info(
    `Deleted ${result.rowCount ?? 0} obsolete worker-ban cron plugin_configs rows`,
    { service: "migration-1128" },
  );
}

const migration: Migration = {
  version: 1128,
  name: "delete_obsolete_worker_ban_cron_configs",
  description:
    "Delete retired worker-ban cron configs replaced by worker_ban_active denorm maintenance.",
  up,
};

registerMigration(migration);

export default migration;