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
 * Cron subsidiary table (plugin_configs_cron).
 *
 * Keeps the cron `schedule` (a cron expression) as a first-class, queryable
 * envelope column rather than burying it in the opaque `plugin_configs.data`
 * blob. Cron plugins are singletons: every cron config gets exactly one row,
 * created by the adapter on write and by the boot-time singleton seeder for
 * built-in jobs, so the generic inner-joined search keeps returning them.
 *
 * The `id` FK to `plugin_configs` is ON DELETE CASCADE (the subsidiary dies
 * with its base config). `schedule` is NOT NULL — a cron config with no
 * schedule is meaningless.
 */
async function up(): Promise<void> {
  if (!(await tableExists("plugin_configs_cron"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_cron (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        schedule varchar NOT NULL
      )
    `);
    logger.info("Created plugin_configs_cron table", {
      service: "migration-1032",
    });
  } else {
    logger.info("plugin_configs_cron table already exists, skipping", {
      service: "migration-1032",
    });
  }
}

const migration: Migration = {
  version: 1032,
  name: "create_plugin_configs_cron",
  description:
    "Create the cron subsidiary table (plugin_configs_cron) with a NOT NULL `schedule` column hoisting the cron expression out of the data blob as a first-class envelope field.",
  up,
};

registerMigration(migration);

export default migration;
