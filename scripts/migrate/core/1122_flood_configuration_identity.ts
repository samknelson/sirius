import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { CONFIGURATION_REVISION_DDL } from "../../../server/storage/configuration-revision-ddl";

const migration: Migration = {
  version: 1122,
  name: "flood_configuration_identity",
  description: "Reset flood history once and associate new counts with typed flood configurations",
  async up() {
    await db.transaction(async tx => {
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS plugin_configs_flood (
          id varchar PRIMARY KEY REFERENCES plugin_configs(id) ON DELETE CASCADE
        );
        INSERT INTO plugin_configs_flood (id)
          SELECT id FROM plugin_configs WHERE plugin_kind = 'flood'
          ON CONFLICT (id) DO NOTHING;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'flood'
              AND column_name = 'plugin_configuration_id'
          ) THEN
            -- Explicitly approved, one-time reset. Never part of app startup.
            DELETE FROM flood;
            ALTER TABLE flood ADD COLUMN plugin_configuration_id varchar NOT NULL;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'flood'::regclass
              AND conname = 'flood_plugin_configuration_id_plugin_configs_flood_id_fk'
          ) THEN
            ALTER TABLE flood ADD CONSTRAINT flood_plugin_configuration_id_plugin_configs_flood_id_fk
              FOREIGN KEY (plugin_configuration_id) REFERENCES plugin_configs_flood(id) ON DELETE CASCADE;
          END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS flood_config_identifier_created_idx
          ON flood (plugin_configuration_id, identifier, created_at);
      `);
      await tx.execute(sql.raw(CONFIGURATION_REVISION_DDL));
    });
  },
};
registerMigration(migration);
export default migration;
