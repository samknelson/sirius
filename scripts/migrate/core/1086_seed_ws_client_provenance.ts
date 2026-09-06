import { storage } from "../../../server/storage";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1086";

/**
 * Which of the four web-service tables' own columns hold provenance facts.
 *
 * `ws_clients` is the only one of the four that tracked a modification date;
 * the three child tables recorded creation and nothing else. None of them
 * recorded a person — nothing in this area was under storage logging until
 * now — so every seeded row carries a date and an unknown actor, which is the
 * whole truth these columns hold.
 */
const TABLES = [
  { table: "ws_clients", createdDateColumn: "created_at", modifiedDateColumn: "updated_at" },
  { table: "ws_client_credentials", createdDateColumn: "created_at" },
  { table: "ws_client_grants", createdDateColumn: "created_at" },
  { table: "ws_client_ip_rules", createdDateColumn: "created_at" },
] as const;

/**
 * Move the web-service configuration tables' bespoke timestamps into
 * provenance, before the next migration drops the columns.
 *
 * The four tables come under the storage logging middleware in the same
 * release, so from now on a client, credential, grant or IP rule records who
 * changed it and when. That says nothing about the rows that already exist:
 * their creation dates live only in their own `created_at` columns, and once
 * those are dropped the history is gone. This is the copy across.
 *
 * The work itself is the shared seeding routine, which is idempotent, wraps
 * its own transaction (the migration runner does not), only ever makes a
 * stamp more truthful, and states a reason rather than failing when a table
 * or column is not there.
 */
async function up(): Promise<void> {
  for (const spec of TABLES) {
    const result = await storage.entityMetadataSeed.seedFromColumns(spec);
    if (!result.seeded) {
      logger.info(`Skipped seeding provenance for ${result.table}: ${result.reason}`, {
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
  version: 1086,
  name: "seed_ws_client_provenance",
  description:
    "Seed entity_metadata for ws_clients (created_at, updated_at), ws_client_credentials, ws_client_grants and ws_client_ip_rules (created_at) from their own timestamp columns, so every existing web-service client, credential, grant and IP rule keeps its creation date once those columns are dropped. Uses the shared seeding routine: idempotent, self-transacting, and a stated skip on a table or column that is not there.",
  up,
};

registerMigration(migration);

export default migration;
