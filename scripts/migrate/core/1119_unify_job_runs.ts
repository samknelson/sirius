import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { logger } from "../../../server/logger";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  // The runner does not wrap migrations in a transaction. Keep the rename,
  // snapshot/backfill and removal of the old column atomic.
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.cron_job_runs') IS NOT NULL THEN
          IF to_regclass('public.job_runs') IS NOT NULL THEN
            RAISE EXCEPTION 'Both cron_job_runs and job_runs exist; refusing to pick one';
          END IF;
          ALTER TABLE cron_job_runs RENAME TO job_runs;
        END IF;
        IF to_regclass('public.job_runs') IS NULL THEN
          RAISE EXCEPTION 'Neither cron_job_runs nor job_runs exists';
        END IF;
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.job_runs'::regclass AND conname = 'cron_job_runs_pkey'
        ) THEN
          ALTER TABLE job_runs RENAME CONSTRAINT cron_job_runs_pkey TO job_runs_pkey;
        END IF;
      END $$;
    `);
    await tx.execute(sql`
      ALTER TABLE job_runs
        ADD COLUMN IF NOT EXISTS configuration_id varchar,
        ADD COLUMN IF NOT EXISTS plugin_kind varchar,
        ADD COLUMN IF NOT EXISTS plugin_id text,
        ADD COLUMN IF NOT EXISTS operation varchar DEFAULT 'execute'
    `);
    await tx.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'job_runs' AND column_name = 'job_name'
        ) THEN
          UPDATE job_runs SET plugin_kind = 'cron', plugin_id = job_name
          WHERE plugin_kind IS NULL OR plugin_id IS NULL;
          -- The old rows record only plugin id, not configuration id. A
          -- currently matching singleton may be a replacement for a deleted
          -- configuration, so no legacy row can be linked with certainty.
          ALTER TABLE job_runs DROP COLUMN job_name;
        END IF;
      END $$;
    `);
    await tx.execute(sql`
      UPDATE job_runs SET operation = 'execute' WHERE operation IS NULL
    `);
    await tx.execute(sql`
      ALTER TABLE job_runs
        ALTER COLUMN plugin_kind SET NOT NULL,
        ALTER COLUMN plugin_id SET NOT NULL,
        ALTER COLUMN operation SET DEFAULT 'execute',
        ALTER COLUMN operation SET NOT NULL
    `);
    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.job_runs'::regclass
            AND conname = 'job_runs_configuration_id_plugin_configs_id_fk'
        ) THEN
          ALTER TABLE job_runs ADD CONSTRAINT job_runs_configuration_id_plugin_configs_id_fk
            FOREIGN KEY (configuration_id) REFERENCES plugin_configs(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS job_runs_configuration_started_idx
        ON job_runs (configuration_id, started_at)
    `);
    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS job_runs_kind_plugin_started_idx
        ON job_runs (plugin_kind, plugin_id, started_at)
    `);
  });
  logger.info("Unified cron execution history in job_runs", { service: "migration-1119" });
}

const migration: Migration = {
  version: 1119,
  name: "unify_job_runs",
  description: "Rename cron run history to job_runs and retain configuration identity and snapshots",
  up,
};

registerMigration(migration);
export default migration;