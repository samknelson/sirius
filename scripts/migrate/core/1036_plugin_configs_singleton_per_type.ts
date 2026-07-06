import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Generalize the singleton backstop from per-KIND to per-TYPE.
 *
 * Previously the race-safe singleton backstop was a partial unique index
 * hardcoded to `WHERE plugin_kind = 'cron'` (`plugin_configs_singleton_cron_uniq`).
 * That meant only cron could be a singleton. This migration replaces that with
 * a persisted per-row marker (`is_singleton`) and an index keyed off it, so any
 * plugin TYPE in any kind can be a singleton just by declaring
 * `singleton: true` in its manifest — no further schema/migration change.
 *
 * Steps (all idempotent):
 *  1. Add the `is_singleton` boolean column (default false, not null).
 *  2. Backfill it to true for rows that were singletons under the old scheme.
 *     The only singleton kind to date is `cron`, so flag existing cron rows.
 *  3. Drop the old cron-scoped partial unique index.
 *  4. Create the new partial unique index on (plugin_kind, plugin_id)
 *     `WHERE is_singleton`, covering every singleton type.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE plugin_configs
    ADD COLUMN IF NOT EXISTS is_singleton boolean NOT NULL DEFAULT false
  `);

  // Backfill: existing singleton rows are exactly the cron rows (cron was the
  // sole singleton kind before this change). Safe to re-run.
  await db.execute(sql`
    UPDATE plugin_configs
    SET is_singleton = true
    WHERE plugin_kind = 'cron' AND is_singleton = false
  `);

  await db.execute(sql`
    DROP INDEX IF EXISTS plugin_configs_singleton_cron_uniq
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS plugin_configs_singleton_uniq
    ON plugin_configs (plugin_kind, plugin_id)
    WHERE is_singleton
  `);

  logger.info(
    "Generalized singleton backstop to per-type via plugin_configs.is_singleton + plugin_configs_singleton_uniq",
    { service: "migration-1036" },
  );
}

const migration: Migration = {
  version: 1036,
  name: "plugin_configs_singleton_per_type",
  description:
    "Add plugin_configs.is_singleton, backfill existing cron rows, drop the cron-scoped partial unique index, and create a per-type partial unique index on (plugin_kind, plugin_id) WHERE is_singleton. Makes the singleton backstop fully per-type instead of hardcoded to cron.",
  up,
};

registerMigration(migration);

export default migration;
