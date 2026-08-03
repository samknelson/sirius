import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Make `options_event_type.sirius_id` nullable. Sirius ID is an optional
 * external identifier; the UNIQUE constraint stays (NULLs don't collide
 * under Postgres UNIQUE semantics).
 */
async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE options_event_type
      ALTER COLUMN sirius_id DROP NOT NULL
  `);

  logger.info("Dropped NOT NULL from options_event_type.sirius_id", {
    service: "migration-1054",
  });
}

const migration: Migration = {
  version: 1114,
  name: "options_event_type_sirius_id_nullable",
  description:
    "Drop NOT NULL from options_event_type.sirius_id (Sirius ID becomes optional; unique constraint retained)",
  up,
};

registerMigration(migration);
