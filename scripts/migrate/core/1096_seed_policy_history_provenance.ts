import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1096";

/**
 * Move `employer_policy_history.created_at` into provenance, ahead of 1097
 * dropping it.
 *
 * The table carries two dates: `date`, the effective date of the policy
 * change (business data, staying), and `created_at`, when the entry was
 * recorded — a second, partial answer to the question `entity_metadata`
 * answers for every logged table (see `docs/provenance-columns.md`). The
 * entry order the history page shows is decided by that recorded-at date, so
 * it has to reach provenance before the column goes or the ordering loses the
 * only thing it sorted on.
 *
 * `created_at` is NOT NULL here, so every existing entry has a date to seed
 * from and none is passed over. It knows only WHEN, never who — which the
 * seeding routine preserves rather than guessing at, so seeded entries keep
 * an unknown creator and only entries recorded from here on name a person.
 *
 * Idempotent, and it wraps its own transaction: both are the shared routine's
 * doing (`server/storage/system/entity-metadata-seed.ts`), as is the stated
 * skip if the column is already gone.
 */
async function up(): Promise<void> {
  const result = await storage.entityMetadataSeed.seedFromColumns({
    table: "employer_policy_history",
    createdDateColumn: "created_at",
  });

  if (!result.seeded) {
    logger.info("Policy history provenance not seeded", {
      service: SERVICE,
      reason: result.reason,
    });
    return;
  }

  logger.info("Seeded policy history provenance from created_at", {
    service: SERVICE,
    records: result.records,
    rowsWritten: result.rowsWritten,
    skippedWithoutDate: result.skippedWithoutDate,
    skippedNotRecordId: result.skippedNotRecordId,
    heldByAnotherTable: result.heldByAnotherTable,
  });
}

const migration: Migration = {
  version: 1096,
  name: "seed_policy_history_provenance",
  description:
    "Seed entity_metadata for employer_policy_history from its own created_at column, so the recorded-at date the history page displays and orders by survives the column being dropped (1097). Idempotent; states a skip when the column is already gone.",
  up,
};

registerMigration(migration);

export default migration;
