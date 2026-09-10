import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1085";

/**
 * Do not drop the snapshot capture columns. They are the authoritative local
 * provenance for an excluded process table, and recreating them later would
 * risk replacing historical values with defaults.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving snapshots.created_at, author_id and author_name",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1160,
  name: "drop_snapshot_author_columns",
  description:
    "Preserve snapshots.created_at, author_id and author_name because snapshots are excluded from entity metadata.",
  up,
};

registerMigration(migration);

export default migration;