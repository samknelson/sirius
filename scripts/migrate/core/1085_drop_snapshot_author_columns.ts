import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1085";

/**
 * Retire the snapshots table's bespoke provenance triple.
 *
 * `created_at`, `author_id` and `author_name` answered when a snapshot was
 * captured and by whom — a question `entity_metadata` answers for every logged
 * table, resolving the person's name at read time instead of freezing it at
 * capture. The previous migration moved what these columns knew into
 * provenance; this one removes them, and the foreign key `author_id` carried
 * goes with it.
 *
 * The entity index is rebuilt without the date. Nothing orders snapshots by a
 * column of their own any more — ordering is by the provenance row's date, on
 * the join — so what the index has to support is finding one entity's
 * snapshots at all.
 *
 * Idempotent: every step states the object it wants and skips a database that
 * has already moved on.
 */
async function up(): Promise<void> {
  // Ordering matters: the replacement index goes in BEFORE the old one is
  // dropped with its column, so a large table is never left without an index
  // on (entity_type, entity_id).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS snapshots_entity_type_entity_id_idx
    ON snapshots (entity_type, entity_id)
  `);

  // Dropping created_at would take this index with it; naming it here keeps
  // the intent visible rather than leaving it to a cascade.
  await db.execute(sql`
    DROP INDEX IF EXISTS snapshots_entity_type_entity_id_created_at_idx
  `);

  // The author_id foreign key is dropped by Postgres along with its column;
  // there is no separate constraint to name.
  await db.execute(sql`
    ALTER TABLE snapshots
      DROP COLUMN IF EXISTS created_at,
      DROP COLUMN IF EXISTS author_id,
      DROP COLUMN IF EXISTS author_name
  `);

  logger.info("Dropped the snapshots created_at/author_id/author_name columns", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1085,
  name: "drop_snapshot_author_columns",
  description:
    "Drop snapshots.created_at/author_id/author_name (now in entity_metadata) and rebuild the entity index without the date",
  up,
};

registerMigration(migration);
