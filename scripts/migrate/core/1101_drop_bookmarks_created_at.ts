import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1101";

/**
 * Drop `bookmarks.created_at`.
 *
 * The date it held now lives in `entity_metadata` — written by the storage
 * logging middleware for new bookmarks and carried across for the existing
 * ones by migration 1100, which runs first — and every read of it goes
 * through the bookmark storage's provenance join. Nothing else reads the
 * column.
 *
 * Idempotent.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    ALTER TABLE bookmarks DROP COLUMN IF EXISTS created_at
  `);
  void result;

  logger.info("Dropped bookmarks.created_at", { service: SERVICE });
}

const migration: Migration = {
  version: 1101,
  name: "drop_bookmarks_created_at",
  description:
    "Drop the bespoke bookmarks.created_at column now that bookmark provenance lives in entity_metadata (seeded by migration 1100 and maintained by storage logging). Idempotent.",
  up,
};

registerMigration(migration);

export default migration;
