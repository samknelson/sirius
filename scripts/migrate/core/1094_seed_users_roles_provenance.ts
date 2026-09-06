import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { createEntityMetadataSeedStorage } from "../../../server/storage/system/entity-metadata-seed";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1094";

/**
 * Move what `users.created_at` / `users.updated_at` and `roles.created_at`
 * know into provenance, before the next migration drops them.
 *
 * The columns are the only record of when these accounts and roles came into
 * being, and dropping them without this would replace every account's real
 * creation date with the date of the migration. Provenance can say more than
 * they ever could — it names a person — but only for what it watched happen;
 * for everything that predates the framework the old column's date IS the
 * history, and it has to be carried over intact.
 *
 * The shared seeding routine does the carrying (see
 * `server/storage/system/entity-metadata-seed.ts`): it wraps its own
 * transaction, only ever makes a stamp more truthful, and reports rather than
 * fails when a column is already gone — which is what makes this safe to
 * re-run on a database where 1095 has already dropped them.
 *
 * Neither table has ever recorded WHO, so no person is seeded here. Accounts
 * created from now on get their creator from the storage logging middleware.
 */
async function up(): Promise<void> {
  const seed = createEntityMetadataSeedStorage();

  const results = [
    await seed.seedFromColumns({
      table: "users",
      createdDateColumn: "created_at",
      modifiedDateColumn: "updated_at",
    }),
    await seed.seedFromColumns({
      table: "roles",
      createdDateColumn: "created_at",
    }),
  ];

  for (const result of results) {
    if (!result.seeded) {
      logger.info(`Seeded no provenance for ${result.table}: ${result.reason}`, {
        service: SERVICE,
      });
      continue;
    }
    logger.info(`Seeded provenance for ${result.table}`, {
      service: SERVICE,
      records: result.records,
      rowsWritten: result.rowsWritten,
      skippedWithoutDate: result.skippedWithoutDate,
      skippedNotRecordId: result.skippedNotRecordId,
      heldByAnotherTable: result.heldByAnotherTable,
    });
  }
}

const migration: Migration = {
  version: 1094,
  name: "seed_users_roles_provenance",
  description:
    "Seed entity_metadata from users.created_at / users.updated_at and roles.created_at, so every existing account and role keeps its real creation and last-changed dates once those columns are dropped.",
  up,
};

registerMigration(migration);

export default migration;
