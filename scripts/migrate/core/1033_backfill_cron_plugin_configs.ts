import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Backfill the legacy `cron_jobs` table into the unified plugin_configs
 * (plugin_kind = 'cron') base table plus its `plugin_configs_cron` subsidiary.
 *
 * Each cron job becomes one base row (plugin_id = cron_jobs.name — the stable
 * identifier that also keys `cron_job_runs.jobName`; enabled = is_enabled;
 * name = description; data = settings or '{}') plus one subsidiary row
 * (schedule = cron_jobs.schedule). `cron_job_runs` history is untouched: its
 * `jobName` already equals the plugin id.
 *
 * Atomic + idempotent: the whole backfill runs in a single transaction (the
 * migration runner does NOT wrap `up()`), so a partial failure rolls back
 * entirely and leaves `cron_jobs` intact for a clean re-run. Any cron name that
 * already has a plugin_configs row (from a prior committed run, or the boot-time
 * singleton seeder) is skipped. On a fresh database with no `cron_jobs` table
 * (a baselined deployment) this is a no-op; the singleton seeder creates the
 * rows instead.
 */
async function up(): Promise<void> {
  if (!(await tableExists("cron_jobs"))) {
    logger.info("cron_jobs table absent, nothing to backfill", {
      service: "migration-1033",
    });
    return;
  }

  await db.transaction(async (tx) => {
    const jobsRes = await tx.execute(sql`
      SELECT name, description, schedule, is_enabled, settings
      FROM cron_jobs
    `);
    const jobs = (jobsRes.rows ?? []) as Array<{
      name: string;
      description: string | null;
      schedule: string;
      is_enabled: boolean;
      settings: Record<string, unknown> | null;
    }>;

    // Existing cron plugin configs — for idempotent re-runs / seeder overlap.
    const existingRes = await tx.execute(sql`
      SELECT plugin_id FROM plugin_configs WHERE plugin_kind = 'cron'
    `);
    const existing = new Set(
      ((existingRes.rows ?? []) as Array<{ plugin_id: string }>).map((r) => r.plugin_id),
    );

    let created = 0;
    let skipped = 0;

    for (const job of jobs) {
      if (existing.has(job.name)) {
        skipped++;
        continue;
      }

      const dataJson = JSON.stringify(job.settings ?? {});
      const inserted = await tx.execute(sql`
        INSERT INTO plugin_configs (plugin_kind, plugin_id, enabled, name, ordering, data)
        VALUES ('cron', ${job.name}, ${job.is_enabled}, ${job.description}, 0, ${dataJson}::jsonb)
        RETURNING id
      `);
      const id = (inserted.rows?.[0] as { id: string }).id;

      await tx.execute(sql`
        INSERT INTO plugin_configs_cron (id, schedule)
        VALUES (${id}, ${job.schedule})
      `);
      created++;
    }

    logger.info("Backfilled cron jobs into plugin_configs", {
      service: "migration-1033",
      created,
      skipped,
      total: jobs.length,
    });
  });
}

const migration: Migration = {
  version: 1033,
  name: "backfill_cron_plugin_configs",
  description:
    "Backfill the legacy cron_jobs table into plugin_configs (plugin_kind='cron') + the plugin_configs_cron subsidiary. Atomic + idempotent; cron_job_runs history is preserved.",
  up,
};

registerMigration(migration);

export default migration;
