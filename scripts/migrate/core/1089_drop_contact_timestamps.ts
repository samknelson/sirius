import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1089";

/**
 * Drop the bespoke timestamps from `contact_phone` and `contact_postal`.
 *
 * Everything these columns knew is in `entity_metadata` by now — migration
 * 1088 put it there, and the storage logging middleware has been keeping both
 * tables' provenance up to date all along. What is left is a second, partial
 * answer to "when was this made, and when did it last change": date-only,
 * person-less, and no longer read by anything. The reads that used to order by
 * them (the SMS number pick, the worker list's phone and address columns, the
 * replacement-primary choice) now ask provenance the same question.
 *
 * Idempotent: every drop is IF EXISTS, so this is safe on a database that has
 * already been brought in line by a schema push.
 */
async function up(): Promise<void> {
  await db.execute(sql`ALTER TABLE contact_phone DROP COLUMN IF EXISTS created_at`);
  await db.execute(sql`ALTER TABLE contact_postal DROP COLUMN IF EXISTS created_at`);
  await db.execute(sql`ALTER TABLE contact_postal DROP COLUMN IF EXISTS updated_at`);

  logger.info("Dropped bespoke timestamps from contact_phone and contact_postal", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1089,
  name: "drop_contact_timestamps",
  description:
    "Drop contact_phone.created_at and contact_postal.created_at / updated_at; their history now lives in entity_metadata",
  up,
};

registerMigration(migration);

export default migration;
