/**
 * Baseline script — Sirius dev Repl — 2026-07-06.
 *
 * Reconciles the version-counter collision left by a large `git pull` merge.
 *
 * The merge introduced core migrations 1032–1040 (cron plugin_configs +
 * subsidiary, singleton `is_singleton` marker, and the denorm framework tables
 * with their matching drops of the legacy `workers.denorm_*` columns). On a
 * dev database that predates them, those numbered migrations should have run —
 * but this Repl's `migrations_version` counter had already been advanced to
 * 1100 by the earlier baseline `sirius-dev-20260618b` (reserved baseline range,
 * >= 1000). Because the migration runner only replays migrations whose version
 * is greater than the stored counter, every migration numbered <= 1100 —
 * including 1032–1040 and the origin/main reconciliation baseline
 * `sirius-dev-20260704` (version 1042) — is silently skipped. The startup drift
 * gate then refuses to boot with:
 *   - missing tables: denorm, plugin_configs_cron, worker_employment_denorm,
 *     worker_msh_denorm, worker_wsh_denorm
 *   - extra table: cron_jobs
 *   - plugin_configs: missing column is_singleton + index
 *     plugin_configs_singleton_uniq
 *   - workers: extra columns denorm_ws_id, denorm_ms_ids, denorm_job_title,
 *     denorm_home_employer_id, denorm_employer_ids
 *
 * This baseline re-invokes the `up()` of each skipped migration (1032 → 1040)
 * in dependency order. Every one of those migrations is already idempotent
 * (CREATE TABLE / INDEX IF NOT EXISTS, ALTER … DROP COLUMN IF EXISTS,
 * information_schema existence checks), so re-running against an
 * already-migrated database is a no-op. The ordering matters: 1032 creates the
 * cron subsidiary before 1033 backfills it, and 1034 drops the legacy cron_jobs
 * table only after the backfill.
 *
 * Registered as a CORE migration at version 1101 (reserved baseline range,
 * >= 1000, and above the 1100 counter so it actually runs). It runs once like
 * any other core migration and is gated by `migrations_version` afterwards.
 */
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

import m1032 from "../core/1032_create_plugin_configs_cron";
import m1033 from "../core/1033_backfill_cron_plugin_configs";
import m1034 from "../core/1034_drop_cron_jobs";
import m1035 from "../core/1035_plugin_configs_singleton_unique";
import m1036 from "../core/1036_plugin_configs_singleton_per_type";
import m1037 from "../core/1037_create_denorm";
import m1038 from "../core/1038_worker_msh_denorm";
import m1039 from "../core/1039_worker_wsh_denorm";
import m1040 from "../core/1040_worker_employment_denorm";

const BASELINE_VERSION = 1101;

// Dependency order — 1032 (create cron subsidiary) before 1033 (backfill it)
// before 1034 (drop legacy cron_jobs); denorm base 1037 before its payload
// tables 1038/1039/1040.
const SKIPPED_MIGRATIONS: Migration[] = [
  m1032,
  m1033,
  m1034,
  m1035,
  m1036,
  m1037,
  m1038,
  m1039,
  m1040,
];

async function up(): Promise<void> {
  for (const migration of SKIPPED_MIGRATIONS) {
    logger.info("Baseline sirius-dev-20260706 re-applying skipped migration", {
      service: "baseline",
      version: migration.version,
      name: migration.name,
    });
    await migration.up();
  }

  logger.info("Baseline sirius-dev-20260706 complete", {
    service: "baseline",
    reappliedCount: SKIPPED_MIGRATIONS.length,
  });
}

const migration: Migration = {
  version: BASELINE_VERSION,
  name: "baseline_sirius_dev_20260706",
  description:
    "Re-invokes the idempotent up() of core migrations 1032-1040 (cron " +
    "plugin_configs + subsidiary, plugin_configs.is_singleton marker, and the " +
    "denorm framework tables with their legacy workers.denorm_* column drops), " +
    "which were skipped on this dev Repl because an earlier baseline advanced " +
    "the migrations_version counter to 1100 above their version numbers.",
  up,
};

registerMigration(migration);

export default migration;
