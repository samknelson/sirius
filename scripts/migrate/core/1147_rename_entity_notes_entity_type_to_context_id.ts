import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1147";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

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
 * Rename `entity_notes.entity_type` to `context_id`.
 *
 * Notes are now attached to a registered *context* — the same thing
 * `entity_files` calls a context, and the same id space ("worker",
 * "employer", …). The column holds a context id, so it says so. Values are
 * untouched: the note contexts are registered under exactly the spellings
 * already stored in this column.
 *
 * A column rename carries its indexes along automatically, so
 * `idx_entity_notes_entity` keeps its name and simply covers
 * `(context_id, entity_id)` afterwards — which is what the schema declares.
 *
 * Idempotent: guarded on the old column still being present.
 */
async function up(): Promise<void> {
  if (!(await tableExists("entity_notes"))) {
    logger.info("entity_notes not present, nothing to rename", { service: SERVICE });
    return;
  }

  if (await columnExists("entity_notes", "entity_type")) {
    if (await columnExists("entity_notes", "context_id")) {
      throw new Error(
        "entity_notes has both `entity_type` and `context_id` — refusing to guess which one is live. " +
          "Resolve by hand before re-running.",
      );
    }
    await db.execute(sql`ALTER TABLE entity_notes RENAME COLUMN entity_type TO context_id`);
    logger.info("Renamed entity_notes.entity_type to context_id", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 1147,
  name: "rename_entity_notes_entity_type_to_context_id",
  description:
    "Rename entity_notes.entity_type to context_id. Notes are attached to a registered note context (the same id space entity_files uses for its contexts), so the column carries a context id. Values are unchanged — contexts are registered under the spellings already stored. The (context_id, entity_id) index keeps its name, idx_entity_notes_entity, because a column rename carries indexes along. Idempotent.",
  up,
};

registerMigration(migration);

export default migration;
