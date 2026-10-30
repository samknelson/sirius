import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { installLedgerIdentityProtection } from "../../../server/storage/ledger/identity-protection";

const migration: Migration = {
  version: 1206,
  name: "lock_ledger_identity",
  description: "Make entity-account identity and ledger-account currency permanent.",
  up: installLedgerIdentityProtection,
};
registerMigration(migration);
export default migration;
