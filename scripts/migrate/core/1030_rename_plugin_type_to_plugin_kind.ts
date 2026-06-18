import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === 't';
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return res.rows[0]?.exists === true || res.rows[0]?.exists === 't';
}

async function up(): Promise<void> {
  // Rename the category discriminator column from plugin_type to plugin_kind.
  // Postgres carries dependent indexes/constraints across a column rename
  // automatically, so no index rebuild is needed. Idempotent: only rename when
  // the old column is present and the new one is not.
  if (!(await tableExists("plugin_configs"))) {
    logger.info("plugin_configs table does not exist, skipping", {
      service: "migration-1030",
    });
    return;
  }

  const hasOld = await columnExists("plugin_configs", "plugin_type");
  const hasNew = await columnExists("plugin_configs", "plugin_kind");

  if (hasOld && !hasNew) {
    await db.execute(sql`ALTER TABLE plugin_configs RENAME COLUMN plugin_type TO plugin_kind`);
    logger.info("Renamed plugin_configs.plugin_type to plugin_kind", {
      service: "migration-1030",
    });
  } else {
    logger.info("plugin_configs.plugin_kind already in place, skipping", {
      service: "migration-1030",
    });
  }
}

const migration: Migration = {
  version: 1030,
  name: "rename_plugin_type_to_plugin_kind",
  description:
    "Rename the plugin_configs category discriminator column from plugin_type to plugin_kind (terminology cleanup; plugin_id unchanged). Idempotent.",
  up,
};

registerMigration(migration);

export default migration;
