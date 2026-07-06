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
 * Drop the now-unused `cron_jobs` table. Cron job configuration lives in
 * plugin_configs (plugin_kind='cron') + plugin_configs_cron after migration
 * 1033.
 *
 * `cron_job_runs` is KEPT (run history, keyed by `jobName` = plugin id). Its
 * legacy FK to `cron_jobs.name` must be dropped first, otherwise dropping
 * `cron_jobs` would fail (and future run inserts would have no parent row). The
 * FK is removed by name discovered from the catalog, so this is independent of
 * Drizzle's constraint-naming scheme. Idempotent: re-running after the table is
 * gone is a no-op.
 */
async function up(): Promise<void> {
  // Drop any FK on cron_job_runs that references cron_jobs.
  await db.execute(sql`
    DO $$
    DECLARE
      conname text;
    BEGIN
      FOR conname IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_class fref ON fref.oid = con.confrelid
        WHERE con.contype = 'f'
          AND rel.relname = 'cron_job_runs'
          AND fref.relname = 'cron_jobs'
      LOOP
        EXECUTE format('ALTER TABLE cron_job_runs DROP CONSTRAINT %I', conname);
      END LOOP;
    END $$;
  `);

  if (await tableExists("cron_jobs")) {
    await db.execute(sql`DROP TABLE cron_jobs`);
    logger.info("Dropped cron_jobs table", { service: "migration-1034" });
  } else {
    logger.info("cron_jobs table already absent, skipping", {
      service: "migration-1034",
    });
  }
}

const migration: Migration = {
  version: 1034,
  name: "drop_cron_jobs",
  description:
    "Drop the legacy cron_jobs table (config now lives in plugin_configs + plugin_configs_cron) after dropping the cron_job_runs FK that referenced it. cron_job_runs history is preserved.",
  up,
};

registerMigration(migration);

export default migration;
