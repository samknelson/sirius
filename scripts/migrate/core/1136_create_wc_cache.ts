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
 * Web-client response cache: `wc_cache` (+ the `wc_cache_outcome` enum).
 *
 * One row per distinct outbound third-party request, unique on
 * (service, request_type, request_key_hash). The hash carries the uniqueness
 * constraint because request keys can be long (a full address); the readable
 * `request_key` is kept alongside it so the table can be browsed.
 *
 * Idempotent: the enum is created only if missing (CREATE TYPE has no
 * IF NOT EXISTS), and the table + its index only if the table is absent.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wc_cache_outcome') THEN
        CREATE TYPE wc_cache_outcome AS ENUM ('success', 'failure');
      END IF;
    END
    $$;
  `);

  if (!(await tableExists("wc_cache"))) {
    await db.execute(sql`
      CREATE TABLE wc_cache (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        service varchar(64) NOT NULL,
        request_type varchar(64) NOT NULL,
        request_key text NOT NULL,
        request_key_hash varchar(64) NOT NULL,
        outcome wc_cache_outcome NOT NULL,
        response jsonb,
        fetched_at timestamp NOT NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT wc_cache_service_type_key_hash_uniq UNIQUE (service, request_type, request_key_hash)
      )
    `);
    await db.execute(
      sql`CREATE INDEX wc_cache_sweep_idx ON wc_cache (service, request_type, fetched_at)`,
    );
    logger.info("Created wc_cache table", { service: "migration-1136" });
  } else {
    logger.info("wc_cache table already exists, skipping", {
      service: "migration-1136",
    });
  }
}

const migration: Migration = {
  version: 1136,
  name: "create_wc_cache",
  description:
    "Create the web-client response cache table wc_cache (one row per distinct outbound third-party request, unique on service + request_type + request_key_hash, with the readable request_key kept alongside the hash) plus the wc_cache_outcome enum ('success','failure') and the (service, request_type, fetched_at) sweep index.",
  up,
};

registerMigration(migration);

export default migration;
