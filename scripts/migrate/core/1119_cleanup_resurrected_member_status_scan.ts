import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const OLD_ID = "member-status-scan";
const BTU_ID = "btu-member-status-scan";

/**
 * Cleanup for a resurrected `member-status-scan` cron row.
 *
 * Migration 1118 renamed the BTU cron plugin `member-status-scan` →
 * `btu-member-status-scan`. However, a server running *pre-rename* code
 * after 1118 was stamped could re-seed a fresh `member-status-scan` row via
 * the boot-time singleton seeder (it seeds from plugin metadata). Since 1118
 * only runs once, that orphan row is never cleaned up and shows up as a
 * stale third entry on the cron config page — and could run as a scheduled
 * job.
 *
 * This migration idempotently:
 * - Deletes any `plugin_configs` row with plugin_kind='cron' and
 *   plugin_id='member-status-scan' plus its `plugin_configs_cron`
 *   subsidiary — but ONLY when the renamed `btu-member-status-scan` row
 *   already exists (so the operator's config is never destroyed; if the BTU
 *   row is absent, 1118's rename semantics apply and we leave it alone).
 * - Rewrites any `cron_job_runs.job_name` rows recorded under the old id
 *   (e.g. runs executed by the stale server after the rename) to the BTU id
 *   so history stays visible under the BTU job.
 *
 * Atomic + idempotent: single transaction; re-runs are no-ops.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const btuRes = await tx.execute(sql`
      SELECT id FROM plugin_configs WHERE plugin_kind = 'cron' AND plugin_id = ${BTU_ID}
    `);
    const btuRow = btuRes.rows?.[0] as { id: string } | undefined;

    let orphanDeleted = false;
    if (btuRow) {
      const orphanRes = await tx.execute(sql`
        SELECT id FROM plugin_configs WHERE plugin_kind = 'cron' AND plugin_id = ${OLD_ID}
      `);
      const orphan = orphanRes.rows?.[0] as { id: string } | undefined;
      if (orphan) {
        await tx.execute(sql`DELETE FROM plugin_configs_cron WHERE id = ${orphan.id}`);
        await tx.execute(sql`DELETE FROM plugin_configs WHERE id = ${orphan.id}`);
        orphanDeleted = true;
      }
    }

    const runs = await tx.execute(sql`
      UPDATE cron_job_runs SET job_name = ${BTU_ID} WHERE job_name = ${OLD_ID}
    `);

    logger.info("Cleaned up resurrected member-status-scan cron config", {
      service: "migration-1119",
      btuRowPresent: !!btuRow,
      orphanDeleted,
      runRowsUpdated: runs.rowCount ?? 0,
    });
  });
}

const migration: Migration = {
  version: 1119,
  name: "cleanup_resurrected_member_status_scan",
  description:
    "Idempotently remove any resurrected member-status-scan cron plugin_configs row (and its cron subsidiary) left by a stale pre-rename server, and rewrite cron_job_runs recorded under the old id to btu-member-status-scan.",
  up,
};

registerMigration(migration);

export default migration;
