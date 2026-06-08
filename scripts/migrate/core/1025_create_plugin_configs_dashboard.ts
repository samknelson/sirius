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
 * Dashboard subsidiary (role). Each dashboard config targets exactly one role;
 * a viewer sees the widget only when they hold that role. The table is created
 * empty here — the NOT NULL `role` column is populated by the idempotent
 * boot-time backfill (`dashboardPluginRegistry.backfillRoleSubsidiaries`) on
 * the same startup, before any request is served.
 *
 * The `id` FK to plugin_configs is ON DELETE CASCADE (the subsidiary dies with
 * its base config). The `role` FK is ON DELETE RESTRICT so a role still in use
 * by a dashboard config cannot be deleted out from under it — which would
 * otherwise leave the config with no subsidiary row and drop it from the
 * inner-joined search/render path.
 */
async function up(): Promise<void> {
  if (!(await tableExists("plugin_configs_dashboard"))) {
    await db.execute(sql`
      CREATE TABLE plugin_configs_dashboard (
        id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE,
        role varchar NOT NULL REFERENCES roles(id) ON DELETE RESTRICT
      )
    `);
    logger.info("Created plugin_configs_dashboard table", { service: "migration-1025" });
  } else {
    logger.info("plugin_configs_dashboard table already exists, skipping", {
      service: "migration-1025",
    });
  }
}

const migration: Migration = {
  version: 1025,
  name: "create_plugin_configs_dashboard",
  description:
    "Create the dashboard subsidiary table (plugin_configs_dashboard) holding the single required role each dashboard config targets. Table is created empty; a boot-time backfill populates the NOT NULL role column.",
  up,
};

registerMigration(migration);

export default migration;
