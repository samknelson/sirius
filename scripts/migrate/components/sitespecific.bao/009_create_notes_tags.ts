import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-009";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("options_sitespecific_bao_notes_tag_types"))) {
    await db.execute(sql`
      CREATE TABLE options_sitespecific_bao_notes_tag_types (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        description text,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb,
        CONSTRAINT options_sitespecific_bao_notes_tag_types_name_unique UNIQUE (name)
      )
    `);
    logger.info("Created options_sitespecific_bao_notes_tag_types table", { service: SERVICE });
  }

  if (!(await tableExists("options_sitespecific_bao_notes_tags"))) {
    await db.execute(sql`
      CREATE TABLE options_sitespecific_bao_notes_tags (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        tag_type_id varchar NOT NULL,
        description text,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb,
        CONSTRAINT options_sitespecific_bao_notes_tags_type_name_uq
          UNIQUE (tag_type_id, name),
        CONSTRAINT options_sitespecific_bao_notes_tags_tag_type_id_fkey
          FOREIGN KEY (tag_type_id) REFERENCES options_sitespecific_bao_notes_tag_types(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created options_sitespecific_bao_notes_tags table", { service: SERVICE });
  }

  if (!(await tableExists("sitespecific_bao_notes_tags"))) {
    const notesTable = sql.raw(await coreNotesTable(db));
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_notes_tags (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        tag_id varchar NOT NULL,
        note_id varchar NOT NULL,
        CONSTRAINT sitespecific_bao_notes_tags_note_tag_uq
          UNIQUE (note_id, tag_id),
        CONSTRAINT sitespecific_bao_notes_tags_tag_id_fkey
          FOREIGN KEY (tag_id) REFERENCES options_sitespecific_bao_notes_tags(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_notes_tags_note_id_fkey
          FOREIGN KEY (note_id) REFERENCES ${notesTable}(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created sitespecific_bao_notes_tags table", { service: SERVICE });
  }
}

/**
 * Core notes table name. Core migration 1146 (upstream 1072) renames `notes`
 * to `entity_notes`; core runs before component migrations, so a fresh
 * install sees the new name while databases stamped before the rename saw
 * the old one. Resolve at run time rather than hard-coding either.
 */
async function coreNotesTable(exec: { execute: (q: any) => Promise<{ rows?: unknown[] }> }): Promise<"notes" | "entity_notes"> {
  const r = await exec.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'entity_notes'`);
  return (r.rows ?? []).length > 0 ? "entity_notes" : "notes";
}

const migration: Migration = {
  version: 9,
  name: "create_notes_tags",
  description:
    "Create the BAO note-tagging tables: options_sitespecific_bao_notes_tag_types and options_sitespecific_bao_notes_tags (unified options lists; each tag belongs to a tag type, cascading with it), and the sitespecific_bao_notes_tags join table (note ↔ tag assignments, cascading with both the note and the tag). Idempotent: table creation is skipped when a table already exists (the enable flow creates them via component schema push first). Constraint names match the drizzle schema declarations so the enable-path push and this migration produce identical DDL.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
