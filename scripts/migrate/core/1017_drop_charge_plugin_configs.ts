import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Drop the legacy charge_plugin_configs table now that charge configs live in
 * the unified plugin_configs (plugin_type='charge') + plugin_configs_charge
 * tables (data copied by migration 1016). Runs strictly after the backfill.
 *
 * ledger.entries.charge_plugin_config_id is a plain varchar with no foreign key
 * to this table, so dropping it does not break referential integrity, and the
 * preserved ids still resolve against plugin_configs.
 */
async function up(): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS charge_plugin_configs`);
  logger.info("Dropped legacy charge_plugin_configs table", { service: "migration-1017" });
}

const migration: Migration = {
  version: 1017,
  name: "drop_charge_plugin_configs",
  description:
    "Drop the legacy charge_plugin_configs table after its rows were migrated to the unified plugin_configs tables in 1016",
  up,
};

registerMigration(migration);

export default migration;
