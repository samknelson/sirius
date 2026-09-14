import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { WC_VENDOR_OPERATION_CATALOG } from "../../../server/plugins/wc-vendors/types";
import { logger } from "../../../server/logger";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

const SERVICE = "migration-1117";
type MigrationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Move the cache from the old service-scoped shape to the WC-vendor operation
 * shape. The old unique constraint has to be removed before the rewrites:
 * canonicalizing two aliases, or removing two different configuration
 * prefixes, can otherwise collide while the old constraint is still present.
 */
export async function migrateWcCache(tx: MigrationTransaction): Promise<void> {
  const legacyOperations = Object.entries(WC_VENDOR_OPERATION_CATALOG).filter(
    ([legacy, canonical]) => legacy !== canonical,
  );
  const operationCases = legacyOperations.map(
    ([legacy, canonical]) => sql`WHEN request_type = ${legacy} THEN ${canonical}`,
  );
  const operationNames = legacyOperations.map(([legacy]) => sql`${legacy}`);

    await tx.execute(sql`
      ALTER TABLE wc_cache
      ADD COLUMN IF NOT EXISTS configuration_id varchar
    `);

    await tx.execute(sql`
      ALTER TABLE wc_cache
      DROP CONSTRAINT IF EXISTS wc_cache_service_type_key_hash_uniq
    `);

    await tx.execute(sql`
      DROP INDEX IF EXISTS wc_cache_sweep_idx
    `);

    // This is deliberately one CASE driven by the authoritative catalog.
    // Request types not in that catalog fall through unchanged.
    if (operationCases.length > 0) {
      await tx.execute(sql`
        UPDATE wc_cache
        SET request_type = CASE
          ${sql.join(operationCases, sql` `)}
          ELSE request_type
        END
        WHERE request_type IN (${sql.join(operationNames, sql`, `)})
      `);
    }

    // A framework key is config-id:operation-key. Only an exact match of the
    // leading segment against the subsidiary table is evidence of that prefix;
    // arbitrary text before a colon must remain part of an unknown key.
    await tx.execute(sql`
      UPDATE wc_cache AS cache
      SET
        configuration_id = config.id,
        request_key = substr(cache.request_key, char_length(config.id) + 2)
      FROM plugin_configs_wc_vendors AS config
      WHERE cache.configuration_id IS NULL
        AND split_part(cache.request_key, ':', 1) = config.id
        AND strpos(cache.request_key, ':') > 0
    `);

    // Recompute every hash, including rows whose readable key was unchanged.
    await tx.execute(sql`
      UPDATE wc_cache
      SET request_key_hash = encode(
        sha256(convert_to(request_key, 'UTF8')),
        'hex'
      )
    `);

    // The service dimension is intentionally gone from uniqueness. Keep the
    // newest answer, breaking fetched_at ties by the stable row id.
    await tx.execute(sql`
      WITH ranked AS (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY request_type, request_key_hash
            ORDER BY fetched_at DESC, id DESC
          ) AS row_number
        FROM wc_cache
      )
      DELETE FROM wc_cache AS cache
      USING ranked
      WHERE cache.id = ranked.id
        AND ranked.row_number > 1
    `);

    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'wc_cache'::regclass
            AND conname = 'wc_cache_configuration_id_fkey'
        ) THEN
          ALTER TABLE wc_cache
          ADD CONSTRAINT wc_cache_configuration_id_fkey
          FOREIGN KEY (configuration_id)
          REFERENCES plugin_configs_wc_vendors(id)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    await tx.execute(sql`
      CREATE INDEX IF NOT EXISTS wc_cache_sweep_idx
      ON wc_cache (request_type, fetched_at)
    `);

    await tx.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'wc_cache'::regclass
            AND conname = 'wc_cache_type_key_hash_uniq'
        ) THEN
          ALTER TABLE wc_cache
          ADD CONSTRAINT wc_cache_type_key_hash_uniq
          UNIQUE (request_type, request_key_hash);
        END IF;
      END
      $$;
    `);
}

async function up(): Promise<void> {
  await db.transaction(migrateWcCache);

  logger.info("Migrated WC cache entries to provider-neutral keys", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1117,
  name: "wc_cache_configuration",
  description:
    "Attribute WC cache entries to configurations, canonicalize known historical operation names, remove configuration prefixes from request keys, collapse duplicates deterministically, and make request type plus key hash globally unique.",
  up,
};

registerMigration(migration);
export default migration;