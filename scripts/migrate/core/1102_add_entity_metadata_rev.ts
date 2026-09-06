import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1102";

/**
 * Add the application-maintained revision to entity_metadata.
 *
 * Adding a NOT NULL column with a default backfills existing rows to their
 * initial revision. Future inserts use the same default; updates increment it
 * explicitly in the application upserts rather than through a trigger.
 *
 * Idempotent.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE entity_metadata
      ADD COLUMN IF NOT EXISTS "rev" integer NOT NULL DEFAULT 1
  `);

  logger.info("Added entity_metadata.rev", { service: SERVICE });
}

const migration: Migration = {
  version: 1102,
  name: "add_entity_metadata_rev",
  description:
    "Add the application-maintained entity_metadata revision, initialized to 1 for existing rows and defaulting to 1 for new rows; application upserts increment it without a database trigger.",
  up,
};

registerMigration(migration);

export default migration;