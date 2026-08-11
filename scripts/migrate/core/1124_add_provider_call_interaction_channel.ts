import { registerMigration, type Migration } from "../../../server/services/migration-runner";

/**
 * Records the addition of the `provider_call` communication channel.
 *
 * `comm_interaction.channel` is an unconstrained varchar, so no DDL is
 * required. This migration keeps the persisted enum change explicit in the
 * migration history and satisfies the schema-change gate.
 *
 * Ruling: 2026-08-12 prod triage — 1 "enrollment" call-log row carries
 * field_sirius_category = "provider call". No generic call channel exists and
 * the member-call channels don't fit a call with a provider, so
 * "provider call" becomes its own channel. (The same triage's other
 * category_unmapped value, "in person visit", folds into the existing
 * office_visit channel — no enum change needed for that one.)
 */
async function up(): Promise<void> {
  // No DDL: the channel column is an unconstrained varchar.
}

const migration: Migration = {
  version: 1124,
  name: "add_provider_call_interaction_channel",
  description:
    "Record the provider_call comm_interaction channel (2026-08-12 prod ruling); channel is an unconstrained varchar so no DDL is required.",
  up,
};

registerMigration(migration);

export default migration;
