import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1084";

/**
 * Snapshots are process output and keep capture provenance on their own row.
 * This version remains registered for migration-history compatibility, but it
 * must not create entity_metadata rows for an excluded table.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving snapshot-local capture columns; snapshots are excluded from entity metadata",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1159,
  name: "seed_snapshot_provenance",
  description:
    "Preserve snapshot-local capture provenance because snapshots are excluded from entity metadata.",
  up,
};

registerMigration(migration);

export default migration;