import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

/**
 * Adds a nullable free-text `position` column to both contact-association
 * tables so staff can record a relationship-specific job title (e.g.
 * "Director of Human Resources"). The value lives on the association, not
 * the shared person record — one contact may hold a different position at
 * each employer/provider.
 *
 * Both statements are idempotent (ADD COLUMN IF NOT EXISTS); existing rows
 * are untouched (NULL = no position).
 */
async function up(): Promise<void> {
  await db.execute(sql`ALTER TABLE employer_contacts ADD COLUMN IF NOT EXISTS position text`);
  await db.execute(sql`ALTER TABLE trust_provider_contacts ADD COLUMN IF NOT EXISTS position text`);
}

const migration: Migration = {
  version: 1126,
  name: "add_contact_position",
  description:
    "Add nullable text `position` to employer_contacts and trust_provider_contacts for relationship-specific job titles.",
  up,
};

registerMigration(migration);

export default migration;
