import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1150";

/**
 * Rename the note-type "applies to" key `data.entityTypes` → `data.contextIds`.
 *
 * File types were added declaring the same thing, and both frameworks call the
 * thing a type applies to a CONTEXT — so the two option kinds now store it
 * under one key rather than one spelling each. The declaration, the API's
 * pairing check and the notes panel move with this migration.
 *
 * Idempotent: rows already carrying `contextIds` are left alone. A row holding
 * BOTH keys is refused rather than guessed at.
 */
async function up(): Promise<void> {
  const tableExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'options_note_type'
    ) AS exists
  `);
  const exists = tableExists.rows?.[0]?.exists;
  if (!(exists === true || exists === "t")) {
    logger.info("options_note_type not present, nothing to rename", { service: SERVICE });
    return;
  }

  const conflicts = await db.execute(sql`
    SELECT id FROM options_note_type
    WHERE data ? 'entityTypes' AND data ? 'contextIds'
  `);
  if ((conflicts.rows?.length ?? 0) > 0) {
    const ids = conflicts.rows.map((r: Record<string, unknown>) => r.id).join(", ");
    throw new Error(
      `Note type(s) ${ids} carry both data.entityTypes and data.contextIds. ` +
        `Remove the stale key from those rows, then restart.`,
    );
  }

  const result = await db.execute(sql`
    UPDATE options_note_type
    SET data = (data - 'entityTypes') || jsonb_build_object('contextIds', data -> 'entityTypes')
    WHERE data ? 'entityTypes'
  `);
  logger.info("Renamed note type applies-to key", {
    service: SERVICE,
    rows: result.rowCount ?? 0,
  });
}

const migration: Migration = {
  version: 1150,
  name: "rename_note_type_entity_types_key",
  description:
    "Rename the note-type applies-to key from data.entityTypes to data.contextIds, matching the new file-type list and the context vocabulary both frameworks use. Idempotent; refuses a row holding both keys.",
  up,
};

registerMigration(migration);

export default migration;
