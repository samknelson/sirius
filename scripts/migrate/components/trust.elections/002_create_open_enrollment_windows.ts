import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "trust.elections";

/**
 * Retired: Open Enrollment windows are now owned by `sitespecific.bao`.
 * Keep this historical migration registered so existing Trust Elections
 * migration state remains valid, but do not create the table for new
 * Trust Elections-only installations.
 */
async function up(): Promise<void> {}

const migration: Migration = {
  version: 2,
  name: "create_open_enrollment_windows",
  description:
    "Retired migration: Open Enrollment windows are now created and owned by sitespecific.bao.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
