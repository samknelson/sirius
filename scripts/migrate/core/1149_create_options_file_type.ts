import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1149";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * File types, and the attachment column that names one.
 *
 * `options_file_type` is the attachment twin of `options_note_type`: the same
 * five columns, and `data.contextIds` naming the entity-file areas a type
 * applies to.
 *
 * `entity_files.type_id` is NULLABLE — attachments predate the list and an
 * area with no types must keep uploading — with an ON DELETE RESTRICT FK so a
 * type in use cannot be deleted out from under its files. Every constraint
 * and index is named explicitly because the startup drift gate compares
 * reflected names against the schema declarations.
 *
 * Idempotent: each piece is guarded on its own existence.
 */
async function up(): Promise<void> {
  if (!(await tableExists("options_file_type"))) {
    await db.execute(sql`
      CREATE TABLE options_file_type (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        description text,
        sirius_id text UNIQUE,
        data jsonb
      )
    `);
    logger.info("Created options_file_type table", { service: SERVICE });
  }

  if (!(await tableExists("entity_files"))) {
    logger.info("entity_files not present, nothing to extend", { service: SERVICE });
    return;
  }

  await db.execute(sql`ALTER TABLE entity_files ADD COLUMN IF NOT EXISTS type_id varchar`);

  if (!(await constraintExists("entity_files_type_id_options_file_type_id_fk"))) {
    await db.execute(sql`
      ALTER TABLE entity_files
        ADD CONSTRAINT entity_files_type_id_options_file_type_id_fk
        FOREIGN KEY (type_id) REFERENCES options_file_type(id) ON DELETE RESTRICT
    `);
    logger.info("Added entity_files.type_id foreign key", { service: SERVICE });
  }

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_entity_files_type_id ON entity_files (type_id)`,
  );
}

const migration: Migration = {
  version: 1149,
  name: "create_options_file_type",
  description:
    "Create the options_file_type table (admin-configurable file types, each declaring the entity-file areas it applies to in data.contextIds) and add the nullable entity_files.type_id column referencing it, ON DELETE RESTRICT, with an index. Type is optional: existing attachments stay untyped and an area with no types keeps uploading. Idempotent.",
  up,
};

registerMigration(migration);

export default migration;
