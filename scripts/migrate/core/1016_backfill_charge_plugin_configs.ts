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
 * Copy every legacy charge_plugin_configs row into the unified plugin_configs
 * base table plus its plugin_configs_charge subsidiary.
 *
 * The original primary key is PRESERVED: ledger.entries.charge_plugin_config_id
 * stores these ids (as a plain varchar with no FK), and other code paths may
 * reference them, so the unified base row MUST reuse the same id. settings maps
 * to the base `data` column; scope/employer/account move to the subsidiary.
 *
 * SHAPE-AWARE: a deployment that jumped straight to the final schema (the
 * publish diff creates plugin_configs at its final shape) has `plugin_kind`
 * instead of the original `plugin_type` column, and its subsidiary's `account`
 * is already NOT NULL. In that case we insert with the final column names and
 * only migrate rows with a non-NULL account — migration 1021 deliberately
 * discards NULL-account charge configs, so skipping them here reaches the
 * exact same end state without creating orphaned base rows.
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

  const legacyHasName = await columnExists("charge_plugin_configs", "name");
  const legacyHasAccount = await columnExists("charge_plugin_configs", "account");
  const baseIsOldShape = await columnExists("plugin_configs", "plugin_type");

  // The legacy table may predate its own `name`/`account` columns (added by
  // later pre-unification migrations), so select them conditionally in BOTH
  // branches.
  const nameExpr = legacyHasName ? sql`name` : sql`NULL`;
  const accountExpr = legacyHasAccount ? sql`account` : sql`NULL`;

  if (baseIsOldShape) {
    // Original path: plugin_configs still has the pre-1030 `plugin_type`
    // column and the subsidiary still allows NULL account.
    const base = await db.execute(sql`
      INSERT INTO plugin_configs (id, plugin_type, plugin_id, enabled, name, ordering, data, created_at, updated_at)
      SELECT id, 'charge', plugin_id, enabled, ${nameExpr}, 0, COALESCE(settings, '{}'::jsonb), created_at, updated_at
      FROM charge_plugin_configs
      ON CONFLICT (id) DO NOTHING
    `);

    const sub = await db.execute(sql`
      INSERT INTO plugin_configs_charge (id, scope, employer_id, account)
      SELECT id, scope, employer_id, ${accountExpr}
      FROM charge_plugin_configs
      ON CONFLICT (id) DO NOTHING
    `);

    logger.info("Backfilled charge plugin configs into unified plugin_configs (old shape)", {
      service: "migration-1016",
      baseInserted: base.rowCount ?? 0,
      subsidiaryInserted: sub.rowCount ?? 0,
    });
    return;
  }

  // Final-shape path: plugin_configs already has `plugin_kind` (and the
  // subsidiary's `account` is NOT NULL). Only rows WITH an account survive —
  // identical to what 1021 would have done to them.
  if (!legacyHasAccount) {
    // Legacy table without an account column cannot satisfy the NOT NULL
    // subsidiary; nothing can be migrated in a way 1021 would have kept.
    logger.warn(
      "charge_plugin_configs has no account column but plugin_configs is final-shape; skipping backfill (1021 would discard all rows)",
      { service: "migration-1016" },
    );
    return;
  }

  const skipped = await db.execute(sql`
    SELECT count(*)::int AS n FROM charge_plugin_configs WHERE account IS NULL
  `);

  const base = await db.execute(sql`
    INSERT INTO plugin_configs (id, plugin_kind, plugin_id, enabled, name, ordering, data, created_at, updated_at)
    SELECT id, 'charge', plugin_id, enabled, ${nameExpr}, 0, COALESCE(settings, '{}'::jsonb), created_at, updated_at
    FROM charge_plugin_configs
    WHERE account IS NOT NULL
    ON CONFLICT (id) DO NOTHING
  `);

  const sub = await db.execute(sql`
    INSERT INTO plugin_configs_charge (id, scope, employer_id, account)
    SELECT id, scope, employer_id, account
    FROM charge_plugin_configs
    WHERE account IS NOT NULL
    ON CONFLICT (id) DO NOTHING
  `);

  logger.info("Backfilled charge plugin configs into unified plugin_configs (final shape)", {
    service: "migration-1016",
    baseInserted: base.rowCount ?? 0,
    subsidiaryInserted: sub.rowCount ?? 0,
    skippedNullAccount: (skipped.rows?.[0] as any)?.n ?? 0,
  });
}

const migration: Migration = {
  version: 1016,
  name: "backfill_charge_plugin_configs",
  description:
    "Copy legacy charge_plugin_configs rows into the unified plugin_configs + plugin_configs_charge tables, preserving ids; shape-aware and idempotent",
  up,
};

registerMigration(migration);

export default migration;
