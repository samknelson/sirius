import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1083";

/**
 * Ledger tables are process-owned and are deliberately excluded from
 * entity_metadata. Their creation columns are the source of truth for payment
 * lists and gateway diagnostics, so this historical migration is now a
 * preservation checkpoint rather than a destructive migration.
 *
 * Keep the version registered forever. Some databases may already have
 * recorded 1083, so deleting or renumbering it would make migration history
 * diverge. Migration 1103 contains the compatibility repair for databases
 * that ran the old destructive implementation.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving ledger-owned creation columns; ledger tables are excluded from entity metadata",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1083,
  name: "retire_ledger_provenance_columns",
  description:
    "Preserve ledger_payments.date_created, ledger_paymentmethods.created_at and ledger_gateway_customers.created_at because ledger tables are excluded from entity metadata.",
  up,
};

registerMigration(migration);

export default migration;