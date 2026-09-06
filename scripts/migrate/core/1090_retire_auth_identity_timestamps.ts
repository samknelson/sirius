import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1090";

/**
 * Retire `auth_identities.created_at` / `updated_at` in favour of provenance.
 *
 * What those two columns actually know is worth keeping: when a sign-in
 * identity was linked to a person, and when it was last changed. That is the
 * question `entity_metadata` answers for every other record, so the dates move
 * there — with the shared seeding routine, which only ever makes a stamp more
 * truthful and can be re-run — and the columns go.
 *
 * Nothing read either column: the identity is written on the sign-in path and
 * displayed nowhere, so there is no read to repoint. From here the identity's
 * created and modified stamps come from the storage logging config in
 * `server/storage/auth-identities.ts`, which is deliberately silent about the
 * last-used bump every login performs — `last_used_at` stays, because being
 * used is not a change to the record.
 *
 * Both steps are idempotent, and the seed is run before the drop so that a
 * re-run after a partial failure still has the columns to read.
 */
async function up(): Promise<void> {
  const seeded = await storage.entityMetadataSeed.seedFromColumns({
    table: "auth_identities",
    createdDateColumn: "created_at",
    modifiedDateColumn: "updated_at",
  });
  logger.info("Seeded auth identity provenance", { service: SERVICE, ...seeded });

  await db.execute(sql`ALTER TABLE auth_identities DROP COLUMN IF EXISTS created_at`);
  await db.execute(sql`ALTER TABLE auth_identities DROP COLUMN IF EXISTS updated_at`);
  logger.info("Dropped auth_identities.created_at and auth_identities.updated_at", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1090,
  name: "retire_auth_identity_timestamps",
  description:
    "Move auth_identities.created_at / updated_at into entity_metadata with the shared provenance seeding routine, then drop both columns. The identity's created and modified stamps come from the storage logging config from here on; last_used_at stays, being an operational stamp about signing in rather than a change to the record. Idempotent.",
  up,
};

registerMigration(migration);

export default migration;
