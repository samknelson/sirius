import { registerMigration, type Migration } from "../../../server/services/migration-runner";

/**
 * Records the addition of the `letter` communication channel.
 *
 * `comm_interaction.channel` is an unconstrained varchar, so no DDL is
 * required. This migration keeps the persisted enum change explicit in the
 * migration history and satisfies the schema-change gate.
 *
 * Ruling: 2026-08-11 prod triage — 7 "appeal denial" call-log rows carry
 * field_sirius_category = "letter" (written correspondence). Rather than
 * rejecting them as category_unmapped, "letter" becomes its own channel.
 */
async function up(): Promise<void> {
  // No DDL: the channel column is an unconstrained varchar.
}

const migration: Migration = {
  version: 1123,
  name: "add_letter_interaction_channel",
  description:
    "Record the letter comm_interaction channel (2026-08-11 prod ruling); channel is an unconstrained varchar so no DDL is required.",
  up,
};

registerMigration(migration);

export default migration;
