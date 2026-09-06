import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1083";

/**
 * This historical migration is now a preservation checkpoint. The later
 * compatibility migration restores metadata coverage selectively: maintained
 * account/payment tables are eligible, while ledger, ledger_ea, and
 * ledger_gateway_customers remain excluded.
 *
 * Keep the version registered forever. Some databases may already have
 * recorded 1083, so deleting or renumbering it would make migration history
 * diverge. Migration 1103 contains the compatibility repair for databases
 * that ran the old destructive implementation.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving ledger-owned creation columns until selective ledger metadata repair",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1083,
  name: "retire_ledger_provenance_columns",
  description:
    "Preserve ledger provenance columns until the selective ledger metadata repair.",
  up,
};

registerMigration(migration);

export default migration;