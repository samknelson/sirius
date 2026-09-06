import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1099";

/**
 * Keep the local worker member-status timestamp. Worker status history is
 * excluded from entity_metadata, and the migration sequence must not delete a
 * value that cannot safely be recreated later.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving worker_msh.created_at; worker history is excluded from entity metadata",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1099,
  name: "drop_worker_msh_created_at",
  description:
    "Preserve worker_msh.created_at because worker status history is excluded from entity metadata.",
  up,
};

registerMigration(migration);

export default migration;