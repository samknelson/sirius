import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Copy every legacy charge_plugin_configs row into the unified plugin_configs
 * (plugin_type = 'charge') base table plus its plugin_configs_charge subsidiary.
 *
 * The original primary key is PRESERVED: ledger.entries.charge_plugin_config_id
 * stores these ids (as a plain varchar with no FK), and other code paths may
 * reference them, so the unified base row MUST reuse the same id. settings maps
 * to the base `data` column; scope/employer/account move to the subsidiary.
 *
 * Idempotent: ON CONFLICT (id) DO NOTHING on both inserts so a re-run (or a run
 * after the data already exists) is a no-op. Guarded on the legacy table still
 * existing so it is safe even after 1017 drops it.
 */
async function up(): Promise<void> {
  if (!(await tableExists("charge_plugin_configs"))) {
    logger.info("charge_plugin_configs already gone, nothing to backfill", {
      service: "migration-1016",
    });
    return;
  }

  const base = await db.execute(sql`
    INSERT INTO plugin_configs (id, plugin_type, plugin_id, enabled, name, ordering, data, created_at, updated_at)
    SELECT id, 'charge', plugin_id, enabled, name, 0, COALESCE(settings, '{}'::jsonb), created_at, updated_at
    FROM charge_plugin_configs
    ON CONFLICT (id) DO NOTHING
  `);

  const sub = await db.execute(sql`
    INSERT INTO plugin_configs_charge (id, scope, employer_id, account)
    SELECT id, scope, employer_id, account
    FROM charge_plugin_configs
    ON CONFLICT (id) DO NOTHING
  `);

  logger.info("Backfilled charge plugin configs into unified plugin_configs", {
    service: "migration-1016",
    baseInserted: base.rowCount ?? 0,
    subsidiaryInserted: sub.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1016,
  name: "backfill_charge_plugin_configs",
  description:
    "Copy legacy charge_plugin_configs rows into the unified plugin_configs (plugin_type='charge') + plugin_configs_charge tables, preserving ids; idempotent",
  up,
};

registerMigration(migration);

export default migration;
