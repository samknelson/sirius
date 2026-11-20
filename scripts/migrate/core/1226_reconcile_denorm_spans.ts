import spans from "./1225_denorm_spans";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

// Staging used 1225 for the retired EDI termination-evidence indexes.
// Replay the idempotent span schema above that counter so those databases
// receive the maintained coverage tables as well. Existing indexes are harmless.
const migration: Migration = {
  ...spans,
  version: 1226,
  name: "reconcile_denorm_spans",
  description: "Ensure coverage span tables exist after the staging migration-version collision.",
};
registerMigration(migration);
export default migration;
