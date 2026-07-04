import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Drop the denormalized `plugin_id` column from `plugin_configs_charge` and the
 * NULL-safe 4-tuple unique index that depended on it (both added by migration
 * 1018).
 *
 * The column only ever existed so a single-table unique index could enforce the
 * billing 4-tuple (plugin_id, scope, employer_id, account) that spans the base
 * `plugin_configs` row + this subsidiary. Duplicate charge configs are now an
 * accepted state, so the DB-level guarantee is no longer wanted. Reads always
 * took the canonical plugin_id from the base row, so dropping the copy is safe.
 *
 * Idempotent: index drop and column drop are both IF EXISTS. The index must be
 * dropped first because it references the column.
 */
async function up(): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS plugin_configs_charge_unique_4tuple`);
  await db.execute(sql`ALTER TABLE plugin_configs_charge DROP COLUMN IF EXISTS plugin_id`);

  logger.info("Dropped 4-tuple unique index and plugin_id column from plugin_configs_charge", {
    service: "migration-1022",
  });
}

const migration: Migration = {
  version: 1022,
  name: "drop_charge_subsidiary_plugin_id",
  description:
    "Drop the denormalized plugin_id column and the 4-tuple unique index from plugin_configs_charge (duplicate charge configs are now allowed)",
  up,
};

registerMigration(migration);

export default migration;
