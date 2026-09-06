import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Compatibility no-op. Migration 1103 owns the conditional repair for
 * databases that already ran the old destructive migrations; adding
 * now()-defaulted columns here would overwrite the meaning of historical
 * process records on a database that did not need repair.
 */
async function up(): Promise<void> {
  logger.info("Process-owned provenance columns were handled by migration 1103", {
    service: "migration-1104",
  });
}

const migration: Migration = {
  version: 1104,
  name: "own_process_capture_provenance",
  description:
    "Keep process-table provenance repair conditional and data-safe; no destructive defaults.",
  up,
};

registerMigration(migration);

export default migration;