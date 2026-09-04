import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1146";

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
 * Rename `notes` to `entity_notes`, so staff notes and file attachments read
 * as the two instances of one framework that they are (`entity_files` already
 * carries the name).
 *
 * A rename in Postgres moves the table only — its indexes and constraints keep
 * the name they were created with. The indexes MUST follow: the startup drift
 * gate matches indexes by name, so leaving `idx_notes_entity` behind would
 * block boot against the renamed schema. Constraint names are matched by
 * signature rather than by name, so renaming those is cosmetic — done anyway
 * so nothing in the database still calls this table `notes`.
 *
 * Idempotent: every step is guarded on the old name still being present, so a
 * database that is already renamed (or freshly created under the new name)
 * passes straight through.
 */
async function up(): Promise<void> {
  if (await tableExists("notes")) {
    if (await tableExists("entity_notes")) {
      throw new Error(
        "Both `notes` and `entity_notes` exist — refusing to guess which one is live. " +
          "Resolve by hand before re-running.",
      );
    }
    await db.execute(sql`ALTER TABLE notes RENAME TO entity_notes`);
    logger.info("Renamed notes table to entity_notes", { service: SERVICE });
  }

  if (!(await tableExists("entity_notes"))) {
    // Nothing to rename: the create migration has not run on this database.
    logger.info("entity_notes not present, nothing to rename", { service: SERVICE });
    return;
  }

  // Indexes: `notes_pkey` → `entity_notes_pkey`, `idx_notes_*` → `idx_entity_notes_*`.
  // Driven off the live catalog rather than a hardcoded list so an index added
  // to the table before this migration ran is carried along too.
  await db.execute(sql`
    DO $$
    DECLARE
      rec record;
      new_name text;
    BEGIN
      FOR rec IN
        SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE i.indrelid = 'entity_notes'::regclass
      LOOP
        IF rec.name LIKE 'notes\\_%' THEN
          new_name := 'entity_' || rec.name;
        ELSIF rec.name LIKE 'idx\\_notes\\_%' THEN
          new_name := 'idx_entity_notes_' || substring(rec.name from length('idx_notes_') + 1);
        ELSE
          CONTINUE;
        END IF;
        IF to_regclass('public.' || quote_ident(new_name)) IS NULL THEN
          EXECUTE format('ALTER INDEX %I RENAME TO %I', rec.name, new_name);
        END IF;
      END LOOP;
    END $$;
  `);

  // Constraints: `notes_pkey`, `notes_type_id_fkey`, `notes_user_id_fkey`.
  // (The primary key's constraint follows its index rename automatically; the
  // loop skips anything already renamed.)
  await db.execute(sql`
    DO $$
    DECLARE
      rec record;
    BEGIN
      FOR rec IN
        SELECT conname AS name
        FROM pg_constraint
        WHERE conrelid = 'entity_notes'::regclass
          AND conname LIKE 'notes\\_%'
      LOOP
        EXECUTE format(
          'ALTER TABLE entity_notes RENAME CONSTRAINT %I TO %I',
          rec.name,
          'entity_' || rec.name
        );
      END LOOP;
    END $$;
  `);

  logger.info("Renamed entity_notes indexes and constraints", { service: SERVICE });
}

const migration: Migration = {
  version: 1146,
  name: "rename_notes_to_entity_notes",
  description:
    "Rename the notes table to entity_notes, matching the entity_files attachment framework, and rename its indexes and constraints to follow (idx_notes_entity → idx_entity_notes_entity, idx_notes_type_id → idx_entity_notes_type_id, notes_pkey / notes_type_id_fkey / notes_user_id_fkey → entity_notes_*). Index names must follow because the startup drift gate matches indexes by name. Rows, columns and values are untouched; idempotent.",
  up,
};

registerMigration(migration);

export default migration;
