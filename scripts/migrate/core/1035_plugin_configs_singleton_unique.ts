import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Race-safe DB backstop for singleton plugin configs.
 *
 * Singleton plugin kinds (currently only `cron`) permit exactly one
 * plugin_configs row per plugin id. The app-level `enforceSingleton`
 * check in storage is "SELECT then INSERT", which is NOT race-safe under
 * concurrent writers (two app boots seeding in parallel, or a double-submit) —
 * both could read "no row" and both insert. This PARTIAL unique index makes the
 * database reject the second insert so the singleton invariant holds even under
 * concurrency.
 *
 * It is PARTIAL (scoped to `plugin_kind = 'cron'`) on purpose: non-singleton
 * kinds (charge, trust-eligibility, …) legitimately have many rows per
 * (plugin_kind, plugin_id) and must NOT be constrained. Extend the predicate
 * (with a new migration + matching schema change) when another singleton kind
 * is introduced.
 *
 * Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS. Runs after the cron backfill
 * (1033) which produces exactly one row per cron plugin id, so no duplicates
 * exist when the unique index is built.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS plugin_configs_singleton_cron_uniq
    ON plugin_configs (plugin_kind, plugin_id)
    WHERE plugin_kind = 'cron'
  `);
  logger.info("Created partial unique index plugin_configs_singleton_cron_uniq", {
    service: "migration-1035",
  });
}

const migration: Migration = {
  version: 1035,
  name: "plugin_configs_singleton_unique",
  description:
    "Add a partial unique index on plugin_configs (plugin_kind, plugin_id) WHERE plugin_kind='cron' as a race-safe DB backstop for singleton cron configs. Scoped to singleton kinds so multi-row kinds are unaffected.",
  up,
};

registerMigration(migration);

export default migration;
