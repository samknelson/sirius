import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'notes'
    ) AS exists
  `);
  const exists = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === "t";
  if (exists) {
    logger.info("notes table already exists, skipping", { service: "migration-1058" });
    return;
  }

  // entity_type / entity_id are a polymorphic pair with no FK (house
  // convention, see `files`): validated at the API layer against the shared
  // note-entity registry and swept by the notes_orphan_sweep cron.
  // type_id IS a real FK with ON DELETE RESTRICT so a note type that is still
  // in use cannot be deleted.
  await db.execute(sql`
    CREATE TABLE notes (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type varchar NOT NULL,
      entity_id varchar NOT NULL,
      type_id varchar NOT NULL REFERENCES options_note_type(id) ON DELETE RESTRICT,
      subject text NOT NULL,
      body text,
      data jsonb,
      timestamp timestamp NOT NULL DEFAULT now(),
      user_id varchar REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await db.execute(sql`CREATE INDEX idx_notes_entity ON notes (entity_type, entity_id)`);
  await db.execute(sql`CREATE INDEX idx_notes_type_id ON notes (type_id)`);

  logger.info("Created notes table", { service: "migration-1058" });
}

const migration: Migration = {
  version: 1058,
  name: "create_notes",
  description:
    "Create the notes table: staff notes attached polymorphically to a record (worker, employer, trust provider), with a restricted FK to options_note_type and a nullable author.",
  up,
};

registerMigration(migration);
