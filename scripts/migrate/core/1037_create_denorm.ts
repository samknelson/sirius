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
 * Denorm base table (denorm) + denorm_status enum.
 *
 * The workflow spine for the denorm framework: one row per
 * (entity_id, config_id) recording whether that entity's denormalized data for
 * a given plugin config is `ok`, `stale`, or `error`, plus when it was computed
 * / went stale and an optional free-text `message`. The actual payloads live in
 * per-plugin tables, not here.
 *
 * `config_id` FKs `plugin_configs(id)` ON DELETE CASCADE (a config's denorm rows
 * die with it). `entity_type` is a plain plugin-defined varchar (no enum).
 * Unique on (entity_id, config_id); secondary indexes on `status` (sweeps) and
 * `config_id` (per-config lookups).
 *
 * Idempotent: the enum is created only if missing (CREATE TYPE has no
 * IF NOT EXISTS), and the table + indexes only if the table is absent.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'denorm_status') THEN
        CREATE TYPE denorm_status AS ENUM ('ok', 'stale', 'error');
      END IF;
    END
    $$;
  `);

  if (!(await tableExists("denorm"))) {
    await db.execute(sql`
      CREATE TABLE denorm (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id varchar NOT NULL,
        entity_type varchar NOT NULL,
        config_id varchar NOT NULL REFERENCES plugin_configs(id) ON DELETE CASCADE,
        status denorm_status NOT NULL,
        computed_at timestamp,
        stale_at timestamp,
        message varchar
      )
    `);
    await db.execute(
      sql`CREATE UNIQUE INDEX denorm_entity_config_uniq ON denorm (entity_id, config_id)`,
    );
    await db.execute(sql`CREATE INDEX denorm_status_idx ON denorm (status)`);
    await db.execute(sql`CREATE INDEX denorm_config_idx ON denorm (config_id)`);
    logger.info("Created denorm table", { service: "migration-1037" });
  } else {
    logger.info("denorm table already exists, skipping", {
      service: "migration-1037",
    });
  }
}

const migration: Migration = {
  version: 1037,
  name: "create_denorm",
  description:
    "Create the denorm workflow base table (denorm) and denorm_status enum: one row per (entity_id, config_id) with status/computed_at/stale_at/message, a config_id FK to plugin_configs ON DELETE CASCADE, a unique (entity_id, config_id) index, and secondary indexes on status and config_id.",
  up,
};

registerMigration(migration);

export default migration;
