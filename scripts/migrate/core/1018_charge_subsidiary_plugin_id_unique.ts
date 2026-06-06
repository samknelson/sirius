import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Restore the billing-critical 4-tuple uniqueness that the legacy
 * charge_plugin_configs table enforced at the DB level (the
 * `..._plugin_id_scope_employer_id_account_unique` constraint).
 *
 * In the unified design the tuple spans two tables — plugin_id lives on
 * plugin_configs (base) while scope/employer_id/account live on
 * plugin_configs_charge (subsidiary) — so a single-table unique index needs a
 * denormalized copy of plugin_id on the subsidiary. We add that column, backfill
 * it from the base row, mark it NOT NULL, and build a NULL-safe unique index
 * (COALESCE on the nullable dimensions) so two global rows for the same plugin
 * (employer_id/account both NULL) collide — something a plain UNIQUE would miss.
 *
 * Idempotent: column add and index creation are guarded / IF NOT EXISTS.
 */
async function up(): Promise<void> {
  const hasColumn = await columnExists("plugin_configs_charge", "plugin_id");

  if (!hasColumn) {
    await db.execute(sql`ALTER TABLE plugin_configs_charge ADD COLUMN plugin_id text`);
    logger.info("Added plugin_id column to plugin_configs_charge", {
      service: "migration-1018",
    });
  }

  // Backfill the denormalized plugin_id from the canonical base row.
  const backfilled = await db.execute(sql`
    UPDATE plugin_configs_charge AS c
    SET plugin_id = p.plugin_id
    FROM plugin_configs AS p
    WHERE p.id = c.id AND (c.plugin_id IS DISTINCT FROM p.plugin_id)
  `);

  // Enforce NOT NULL only once every row is populated (no-op if already set).
  await db.execute(sql`ALTER TABLE plugin_configs_charge ALTER COLUMN plugin_id SET NOT NULL`);

  // NULL-safe 4-tuple uniqueness: COALESCE the nullable dimensions to a sentinel
  // so NULL employer_id / account participate in collision detection.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS plugin_configs_charge_unique_4tuple
    ON plugin_configs_charge (plugin_id, scope, COALESCE(employer_id, ''), COALESCE(account, ''))
  `);

  logger.info("Backfilled plugin_id and created 4-tuple unique index on plugin_configs_charge", {
    service: "migration-1018",
    backfilled: backfilled.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1018,
  name: "charge_subsidiary_plugin_id_unique",
  description:
    "Denormalize plugin_id onto plugin_configs_charge and add a NULL-safe unique index on (plugin_id, scope, employer_id, account) to restore the legacy charge 4-tuple DB constraint",
  up,
};

registerMigration(migration);

export default migration;
