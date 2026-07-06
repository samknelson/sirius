import { randomUUID } from "crypto";
import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "dispatch";

interface LegacyEligibilityEntry {
  pluginId?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/**
 * Backfill the legacy `options_dispatch_job_type.data.eligibility` JSON array
 * (a list of `{ pluginId, enabled, config }` entries scoped to a job type) into
 * the unified plugin_configs (plugin_kind = 'dispatch-eligibility') base table
 * plus its plugin_configs_dispatch subsidiary, then retire the blob array.
 *
 * Each entry becomes one base row (plugin_id = pluginId, enabled = entry.enabled
 * so a configured-but-disabled plugin stays disabled, ordering = the entry's
 * index, data = the entry's config object) plus one subsidiary row
 * (job_type = the job type's id). Ordering is not significant for dispatch
 * (conditions are AND'd together) but the array index is preserved anyway.
 *
 * Owned by the `dispatch` component. The component schema-push creates
 * `options_dispatch_job_type` and `plugin_configs_dispatch` before this runs,
 * so no table-existence guard is needed.
 *
 * Atomic + idempotent: the whole backfill (inserts AND the blob strip) runs in a
 * single transaction, so a partial failure rolls back entirely and leaves the
 * legacy blob intact for a clean re-run. Any job type that already has
 * dispatch-eligibility rows (from a prior fully-committed run) is skipped.
 *
 * After every job type is processed, the `eligibility` key is removed from each
 * job type's `data` jsonb. All other job-type blob fields (icon, min/max
 * workers, offer ratio/timeout, notificationMedia, etc.) STAY on the blob.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const jobTypesRes = await tx.execute(
      sql`SELECT id, data FROM options_dispatch_job_type`,
    );
    const jobTypes = (jobTypesRes.rows ?? []) as Array<{
      id: string;
      data: Record<string, unknown> | null;
    }>;

    // Job types that already have dispatch-eligibility rows — for idempotent
    // re-runs after a prior fully-committed run.
    const existingRes = await tx.execute(sql`
      SELECT DISTINCT d.job_type AS job_type
      FROM plugin_configs pc
      JOIN plugin_configs_dispatch d ON d.id = pc.id
      WHERE pc.plugin_kind = 'dispatch-eligibility'
        AND d.job_type IS NOT NULL
    `);
    const jobTypesWithRows = new Set(
      ((existingRes.rows ?? []) as Array<{ job_type: string }>).map(
        (r) => r.job_type,
      ),
    );

    let entriesInserted = 0;

    for (const jobType of jobTypes) {
      if (jobTypesWithRows.has(jobType.id)) continue;

      const data = jobType.data ?? {};
      const eligibility = (data.eligibility ?? []) as LegacyEligibilityEntry[];
      if (!Array.isArray(eligibility) || eligibility.length === 0) continue;

      for (let i = 0; i < eligibility.length; i += 1) {
        const entry = eligibility[i];
        if (!entry || !entry.pluginId) continue;

        const config = (entry.config ?? {}) as Record<string, unknown>;
        const enabled = entry.enabled === true;
        const id = randomUUID();

        await tx.execute(sql`
          INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, name, ordering, data)
          VALUES (${id}, 'dispatch-eligibility', ${entry.pluginId}, ${enabled}, NULL, ${i}, ${JSON.stringify(config)}::jsonb)
        `);
        await tx.execute(sql`
          INSERT INTO plugin_configs_dispatch (id, job_type)
          VALUES (${id}, ${jobType.id})
        `);
        entriesInserted += 1;
      }
    }

    const stripped = await tx.execute(sql`
      UPDATE options_dispatch_job_type
      SET data = data - 'eligibility'
      WHERE data -> 'eligibility' IS NOT NULL
    `);

    logger.info(
      "Backfilled dispatch eligibility entries into unified plugin_configs",
      {
        service: "migration-dispatch-001",
        entriesInserted,
        jobTypesStripped: stripped.rowCount ?? 0,
      },
    );
  });
}

const migration: Migration = {
  version: 1,
  name: "backfill_dispatch_eligibility_configs",
  description:
    "Copy options_dispatch_job_type.data.eligibility into the unified plugin_configs (plugin_kind='dispatch-eligibility') + plugin_configs_dispatch tables, preserving enabled/config per job type; then strip the eligibility array from the blob. Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
