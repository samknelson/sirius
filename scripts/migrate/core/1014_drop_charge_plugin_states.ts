import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1014";

async function up(): Promise<void> {
  // The per-plugin master enable switch has been removed. Charge plugins are
  // now controlled exclusively at the per-configuration level, so the
  // charge_plugin_states table is no longer needed. No data is preserved.
  await db.execute(sql`DROP TABLE IF EXISTS charge_plugin_states`);
  logger.info("Dropped charge_plugin_states table", { service: SERVICE });
}

const migration: Migration = {
  version: 1014,
  name: "drop_charge_plugin_states",
  description: "Drop the charge_plugin_states master-enable table; charge plugins are now controlled per-configuration only.",
  up,
};

registerMigration(migration);
