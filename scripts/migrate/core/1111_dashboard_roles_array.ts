import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Convert plugin_configs_dashboard.role (single varchar with an FK to roles)
 * into a non-null `roles` varchar[] so one dashboard config can target
 * multiple roles. Existing single-role values become one-element arrays.
 * Dropping the old column also drops its RESTRICT FK — the equivalent
 * protection now lives in storage.users.deleteRole.
 */
async function up(): Promise<void> {
  const columnCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'plugin_configs_dashboard'
        AND column_name = 'roles'
    ) AS exists
  `);
  const exists = columnCheck.rows[0]?.exists === true || columnCheck.rows[0]?.exists === 't';
  if (exists) {
    logger.info("plugin_configs_dashboard.roles already exists, skipping", { service: "migration-1051" });
    return;
  }

  await db.execute(sql`
    ALTER TABLE plugin_configs_dashboard ADD COLUMN roles varchar[]
  `);
  await db.execute(sql`
    UPDATE plugin_configs_dashboard SET roles = ARRAY[role]::varchar[]
  `);
  await db.execute(sql`
    ALTER TABLE plugin_configs_dashboard
      ALTER COLUMN roles SET NOT NULL,
      DROP COLUMN role
  `);

  logger.info("Converted plugin_configs_dashboard.role to roles varchar[] (one-element arrays)", {
    service: "migration-1051",
  });
}

const migration: Migration = {
  version: 1111,
  name: "dashboard_roles_array",
  description:
    "Convert plugin_configs_dashboard.role (varchar FK) to non-null roles varchar[]; existing values become one-element arrays; FK dropped (role-deletion guard moves to storage)",
  up,
};

registerMigration(migration);
