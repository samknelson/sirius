import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1095";

/**
 * Drop `users.created_at`, `users.updated_at` and `roles.created_at`.
 *
 * Both tables are under storage logging, so every mutation already writes a
 * provenance row, and 1094 has just carried the old columns' dates across.
 * What is left is a duplicate answer to "when was this made" that can never
 * name a person — see `docs/provenance-columns.md`.
 *
 * Idempotent.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE users
      DROP COLUMN IF EXISTS created_at,
      DROP COLUMN IF EXISTS updated_at
  `);
  await db.execute(sql`ALTER TABLE roles DROP COLUMN IF EXISTS created_at`);
  logger.info("Dropped the users and roles timestamp columns", { service: SERVICE });
}

const migration: Migration = {
  version: 1095,
  name: "drop_users_roles_timestamps",
  description:
    "Drop users.created_at, users.updated_at and roles.created_at; both tables' history now lives in entity_metadata, which also names the person responsible.",
  up,
};

registerMigration(migration);

export default migration;
