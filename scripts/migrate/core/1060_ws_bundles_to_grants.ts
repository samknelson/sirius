import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Replace the web service "bundle" concept with per-configuration grants.
 *
 * A bundle was a row in a dedicated table that merely registered things
 * defined in code, with each client assigned to exactly one of them. The
 * unified plugin framework already solves that: a web service is now a
 * `plugin_configs` row of kind `web-service`, and a client is granted access
 * to any number of them.
 *
 * - Drops `ws_clients.bundle_id` (and its index) — clients no longer belong to
 *   a bundle.
 * - Retains the empty legacy table/enum during the compatibility release.
 *   A subsequent Publish removes them after the incoming FK is gone.
 * - Creates `ws_client_grants`, the client -> configuration join. Both foreign
 *   keys cascade, so deleting a client or retiring a configuration can never
 *   leave a dangling authorization behind. The pair is unique via a NAMED
 *   UNIQUE CONSTRAINT (not a unique index) so the reflected DDL matches the
 *   Drizzle `unique()` declaration and the startup drift gate stays quiet.
 *
 * Nothing ever consumed the bundle framework, so no data is migrated.
 *
 * Idempotent: every step is guarded and skipped when already applied.
 */
async function up(): Promise<void> {
  if (await columnExists("ws_clients", "bundle_id")) {
    await db.execute(sql`DROP INDEX IF EXISTS ws_clients_bundle_id_idx`);
    await db.execute(sql`ALTER TABLE ws_clients DROP COLUMN bundle_id`);
    logger.info("Dropped ws_clients.bundle_id", { service: "migration-1060" });
  } else {
    logger.info("ws_clients.bundle_id already gone, skipping", {
      service: "migration-1060",
    });
  }

  if (!(await tableExists("ws_client_grants"))) {
    await db.execute(sql`
      CREATE TABLE ws_client_grants (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id varchar NOT NULL REFERENCES ws_clients(id) ON DELETE CASCADE,
        config_id varchar NOT NULL REFERENCES plugin_configs(id) ON DELETE CASCADE,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT ws_client_grants_client_config_unique UNIQUE (client_id, config_id)
      )
    `);
    await db.execute(sql`
      CREATE INDEX ws_client_grants_client_id_idx ON ws_client_grants (client_id)
    `);
    await db.execute(sql`
      CREATE INDEX ws_client_grants_config_id_idx ON ws_client_grants (config_id)
    `);
    logger.info("Created ws_client_grants", { service: "migration-1060" });
  } else {
    logger.info("ws_client_grants already exists, skipping", {
      service: "migration-1060",
    });
  }
}

const migration: Migration = {
  version: 1060,
  name: "ws_bundles_to_grants",
  description:
    "Replace web service bundles with per-configuration grants; retain the retired parent table/enum for the first compatibility Publish and remove them through the subsequent cleanup Publish.",
  up,
};

registerMigration(migration);
