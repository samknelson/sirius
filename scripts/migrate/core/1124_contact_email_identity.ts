import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/boot/migration-runner";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function migrateContactEmails(tx: Transaction): Promise<void> {
  await tx.execute(sql`LOCK TABLE contacts IN SHARE ROW EXCLUSIVE MODE`);
  const duplicates = await tx.execute(sql`
    SELECT array_agg(id ORDER BY id) AS ids
    FROM contacts
    WHERE nullif(btrim(email), '') IS NOT NULL
    GROUP BY lower(nullif(btrim(email), ''))
    HAVING count(*) > 1
  `);
  if (duplicates.rows.length) {
    throw new Error(`Contact email migration refused: resolve duplicate trimmed/case-insensitive emails for contact ID groups ${JSON.stringify(duplicates.rows)}. No contacts were changed.`);
  }
  await tx.execute(sql`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_unique`);
  await tx.execute(sql`UPDATE contacts SET email = nullif(btrim(email), '') WHERE email IS DISTINCT FROM nullif(btrim(email), '')`);
  await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_normalized_unique ON contacts (lower(nullif(btrim(email), ''::text)))`);
}

const migration: Migration = {
  version: 1124,
  name: "contact_email_identity",
  description: "Case-insensitive contact email uniqueness without merging identities",
  async up() {
    await db.transaction(migrateContactEmails);
  },
};
registerMigration(migration);
export default migration;
