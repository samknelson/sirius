import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Convert plugin_configs_dashboard.role (single varchar with an FK to roles)
 * into a non-null `roles` varchar[] so one dashboard config can target
 * multiple roles. Existing single-role values become one-element arrays.
 * The first Publish retains the old column so its values survive the schema
 * diff. Copy them even when Publish has already created the roles array.
 * Retiring the old column/FK belongs to a subsequent Publish, not startup.
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
  if (!exists) {
    await db.execute(sql`
      ALTER TABLE plugin_configs_dashboard ADD COLUMN roles varchar[]
    `);
  }

  const legacyColumnCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'plugin_configs_dashboard'
        AND column_name = 'role'
    ) AS exists
  `);
  const legacyExists = legacyColumnCheck.rows[0]?.exists === true || legacyColumnCheck.rows[0]?.exists === 't';
  if (legacyExists) {
    await db.execute(sql`
      UPDATE plugin_configs_dashboard SET roles = ARRAY[role]::varchar[]
      WHERE role IS NOT NULL AND (roles IS NULL OR cardinality(roles) = 0)
    `);
  }
  // Publish already enforces NOT NULL. Keep the original DDL only for the
  // original pre-array schema; an already-published shape needs only the copy.
  if (!exists) {
    await db.execute(sql`
      ALTER TABLE plugin_configs_dashboard
        ALTER COLUMN roles SET NOT NULL
    `);
  }

  logger.info("Converted plugin_configs_dashboard.role to roles varchar[] (one-element arrays)", {
    service: "migration-1051",
  });
}

const migration: Migration = {
  version: 1051,
  name: "dashboard_roles_array",
  description:
    "Copy legacy dashboard role values into non-null roles arrays, including when Publish already added roles; retain the legacy column until the cleanup Publish.",
  up,
};

registerMigration(migration);
