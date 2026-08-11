import { registerMigration, type Migration } from "../../../server/services/migration-runner";

/**
 * Records the addition of the `issue_reported` communication channel.
 *
 * `comm_interaction.channel` is intentionally an unconstrained varchar, so no
 * DDL is required. This migration keeps the persisted enum change explicit in
 * the migration history and satisfies the schema-change gate.
 */
async function up(): Promise<void> {
  // No DDL: the channel column is a varchar and accepts new channel values.
}

const migration: Migration = {
  version: 1122,
  name: "add_issue_reported_interaction_channel",
  description:
    "Record the issue_reported comm_interaction channel; channel is an unconstrained varchar so no DDL is required.",
  up,
};

registerMigration(migration);

export default migration;