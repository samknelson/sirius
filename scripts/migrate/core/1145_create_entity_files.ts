import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1145";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * One shared attachment table for the entity-files framework, replacing the
 * bespoke grievance join table.
 *
 * `context_id` / `entity_id` are a polymorphic pair with no FK to the owning
 * record (the house convention, same as `notes` and `files`): existence is
 * checked at the API layer against the registered context. `file_id` IS a
 * real FK to `files` with ON DELETE CASCADE, and UNIQUE so a files row backs
 * at most one attachment.
 *
 * The old `grievance_files` table is dropped destructively — its rows were
 * test data and no migration of them was wanted. The files rows they owned
 * are deleted first so they do not linger as unreachable attachments; their
 * objects are left to the existing consistency sweep. `grievance_files` is
 * owned by the (optional, default-off) `grievance` component, so the drop is
 * guarded on the table actually being present.
 *
 * Finally the stored `entity_files_config` variable is rewritten from the
 * retired per-context token `:grievance-id` to the single framework token
 * `:entity-id`, so an existing configured directory keeps pointing at the
 * same place.
 *
 * Idempotent throughout.
 */
async function up(): Promise<void> {
  if (!(await tableExists("entity_files"))) {
    await db.execute(sql`
      CREATE TABLE entity_files (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "context_id" varchar NOT NULL,
        "entity_id" varchar NOT NULL,
        "file_id" varchar NOT NULL,
        "name" varchar(255) NOT NULL,
        "data" jsonb,
        CONSTRAINT entity_files_file_id_files_id_fk
          FOREIGN KEY ("file_id") REFERENCES files (id) ON DELETE CASCADE,
        CONSTRAINT entity_files_file_id_unique UNIQUE ("file_id")
      )
    `);
    await db.execute(
      sql`CREATE INDEX idx_entity_files_entity ON entity_files (context_id, entity_id)`,
    );
    logger.info("Created entity_files table", { service: SERVICE });
  }

  // grievance_files belongs to the optional `grievance` component: on a
  // fresh database, or anywhere that component was never enabled, there is
  // nothing to drop.
  const hasLegacyTable = await tableExists("grievance_files");
  if (hasLegacyTable) {
    // Deleting the files rows cascades the attachment rows away with them.
    await db.execute(sql`
      DELETE FROM files WHERE id IN (SELECT file_id FROM grievance_files)
    `);
    await db.execute(sql`DROP TABLE grievance_files`);
    logger.info("Dropped grievance_files and its orphaned files rows", {
      service: SERVICE,
    });
  } else {
    logger.info("grievance_files not present, nothing to drop", { service: SERVICE });
  }

  // Retire the per-context directory token in the stored operator config.
  await db.execute(sql`
    UPDATE variables
    SET value = replace(value::text, ':grievance-id', ':entity-id')::jsonb
    WHERE name = 'entity_files_config'
      AND value::text LIKE '%:grievance-id%'
  `);
}

const migration: Migration = {
  version: 1145,
  name: "create_entity_files",
  description:
    "Create the shared entity_files attachment table (context_id/entity_id soft reference like notes, file_id UNIQUE FK→files cascade, display name, data jsonb, index on context+entity) for the generic entity-files framework; destructively drop the retired grievance_files join table together with the files rows it owned (guarded on the optional grievance component's table being present); and rewrite the stored entity_files_config directory template from the retired :grievance-id token to the single framework token :entity-id.",
  up,
};

registerMigration(migration);

export default migration;
