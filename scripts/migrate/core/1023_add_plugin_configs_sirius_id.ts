import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'plugin_configs'
    ) AS exists
  `);
  const hasTable = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (!hasTable) {
    logger.info("plugin_configs table missing; skipping", {
      service: "migration-1023",
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'plugin_configs' AND column_name = 'sirius_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    await db.execute(sql`
      ALTER TABLE plugin_configs ADD COLUMN sirius_id varchar
    `);
    logger.info("Added sirius_id column to plugin_configs", {
      service: "migration-1023",
    });
  }

  const constraintCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'plugin_configs'::regclass
        AND conname = 'plugin_configs_sirius_id_unique'
    ) AS exists
  `);
  const hasConstraint = constraintCheck.rows[0]?.exists === true || constraintCheck.rows[0]?.exists === 't';
  if (!hasConstraint) {
    await db.execute(sql`
      ALTER TABLE plugin_configs
      ADD CONSTRAINT plugin_configs_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint plugin_configs_sirius_id_unique", {
      service: "migration-1023",
    });
  }
}

const migration: Migration = {
  version: 1023,
  name: "add_plugin_configs_sirius_id",
  description: "Add optional unique sirius_id column to plugin_configs (component-owned config reconciliation)",
  up,
};

registerMigration(migration);

export default migration;
