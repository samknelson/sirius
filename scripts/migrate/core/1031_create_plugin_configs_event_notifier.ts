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
 * Event-notifier subsidiary table (plugin_configs_event_notifier).
 *
 * Hoists the per-config "active media" selection out of the opaque
 * `plugin_configs.data` blob into a real, filterable envelope column so the
 * generic admin page can render and filter on it. `media` is a nullable
 * comma-joined list (e.g. "email,sms"); the plugin declares which media it can
 * send through and the admin picks the active subset per config.
 *
 * The `id` FK to `plugin_configs` is ON DELETE CASCADE (the subsidiary dies
 * with its base config). Every event-notifier config gets one row, created by
 * the adapter on write and by an idempotent boot-time backfill for pre-existing
 * configs, so the generic inner-joined search keeps returning them.
 */
async function up(): Promise<void> {
  if (!(await tableExists("plugin_configs_event_notifier"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_event_notifier (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        media text
      )
    `);
    logger.info("Created plugin_configs_event_notifier table", {
      service: "migration-1031",
    });
  } else {
    logger.info("plugin_configs_event_notifier table already exists, skipping", {
      service: "migration-1031",
    });
  }
}

const migration: Migration = {
  version: 1031,
  name: "create_plugin_configs_event_notifier",
  description:
    "Create the event-notifier subsidiary table (plugin_configs_event_notifier) with a nullable comma-joined `media` column hoisting the per-config active-media selection out of the data blob.",
  up,
};

registerMigration(migration);

export default migration;
