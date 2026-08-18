import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

/**
 * Replaces the raw-column unique on `contacts.email` with a case-insensitive
 * unique index on `lower(email)`.
 *
 * The S1 loaders dedupe email addresses case-insensitively (shared-address
 * ownership resolves via the S1 user↔contact association), but the old
 * `contacts_email_unique` constraint compared raw bytes, so two contacts
 * could hold emails differing only by case. The database must reject that.
 *
 * Pre-check: aborts (loud, before any DDL) if existing rows collide
 * case-insensitively — collision groups are reported by contact id only
 * (never the addresses themselves).
 *
 * Runner is non-transactional; both statements are idempotent, so a rerun
 * after a partial failure converges.
 */
async function up(): Promise<void> {
  const res = await db.execute(sql`
    SELECT array_agg(id ORDER BY id) AS ids
      FROM contacts
     WHERE email IS NOT NULL
     GROUP BY lower(email)
    HAVING count(*) > 1
  `);
  const groups = (res as unknown as { rows: Array<{ ids: string[] }> }).rows;
  if (groups.length > 0) {
    const sample = groups.slice(0, 10).map((g) => g.ids.join("+")).join("; ");
    throw new Error(
      `contacts_email_ci_unique: ${groups.length} case-insensitive email collision group(s) exist; ` +
        `resolve before migrating. Contact ids: ${sample}${groups.length > 10 ? " …" : ""}`,
    );
  }
  await db.execute(sql`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_unique`);
  // Some environments may carry the default Postgres name instead.
  await db.execute(sql`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_key`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_lower_unique ON contacts (lower(email))`);
}

const migration: Migration = {
  version: 1125,
  name: "contacts_email_ci_unique",
  description:
    "Replace contacts_email_unique with a case-insensitive unique index on lower(email); pre-checks for existing case-insensitive collisions and fails loud (ids only).",
  up,
};

registerMigration(migration);

export default migration;
