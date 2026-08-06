import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const OLD_ID = "member-status-scan";
const NEW_ID = "btu-member-status-scan";

/**
 * Rename the BTU-specific `member-status-scan` cron plugin to
 * `btu-member-status-scan`, migrating the persisted references so the
 * operator's schedule / enabled / settings and the run history survive:
 *
 * - `plugin_configs` (plugin_kind='cron'): plugin_id rename. If the boot-time
 *   singleton seeder already created a fresh row under the NEW id (it runs
 *   from plugin metadata, so a boot with the renamed plugin but without this
 *   migration would seed defaults), the seeded row + its `plugin_configs_cron`
 *   subsidiary are deleted and the OLD row (carrying the operator's config)
 *   is renamed over it.
 * - `cron_job_runs.job_name`: rewritten so history stays queryable under the
 *   new id.
 *
 * Atomic + idempotent: runs in one transaction; re-runs are no-ops.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const oldRes = await tx.execute(sql`
      SELECT id FROM plugin_configs WHERE plugin_kind = 'cron' AND plugin_id = ${OLD_ID}
    `);
    const oldRow = oldRes.rows?.[0] as { id: string } | undefined;

    if (oldRow) {
      // Remove any freshly-seeded row under the new id so the operator's
      // original config wins the rename.
      const seededRes = await tx.execute(sql`
        SELECT id FROM plugin_configs WHERE plugin_kind = 'cron' AND plugin_id = ${NEW_ID}
      `);
      const seeded = seededRes.rows?.[0] as { id: string } | undefined;
      if (seeded) {
        await tx.execute(sql`DELETE FROM plugin_configs_cron WHERE id = ${seeded.id}`);
        await tx.execute(sql`DELETE FROM plugin_configs WHERE id = ${seeded.id}`);
      }

      await tx.execute(sql`
        UPDATE plugin_configs
        SET plugin_id = ${NEW_ID},
            name = 'BTU Member Status Scan'
        WHERE id = ${oldRow.id}
      `);
    }

    const runs = await tx.execute(sql`
      UPDATE cron_job_runs SET job_name = ${NEW_ID} WHERE job_name = ${OLD_ID}
    `);

    logger.info("Renamed member-status-scan cron to btu-member-status-scan", {
      service: "migration-1118",
      configRenamed: !!oldRow,
      runRowsUpdated: runs.rowCount ?? 0,
    });
  });
}

const migration: Migration = {
  version: 1118,
  name: "rename_member_status_scan_cron",
  description:
    "Rename the BTU-specific member-status-scan cron plugin to btu-member-status-scan: plugin_configs plugin_id + cron_job_runs.job_name, preserving operator config and run history.",
  up,
};

registerMigration(migration);

export default migration;
