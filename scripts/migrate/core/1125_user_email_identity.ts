import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/boot/migration-runner";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function migrateUserEmails(tx: Transaction): Promise<void> {
  // Keep inventory, normalization and enforcement atomic against concurrent writes.
  await tx.execute(sql`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`);
  const duplicates = await tx.execute(sql`
    SELECT array_agg(id ORDER BY id) AS ids
    FROM users
    WHERE nullif(btrim(email), '') IS NOT NULL
    GROUP BY lower(nullif(btrim(email), ''))
    HAVING count(*) > 1
  `);
  if (duplicates.rows.length) {
    throw new Error(`User email migration refused: resolve duplicate trimmed/case-insensitive emails for user account ID groups ${JSON.stringify(duplicates.rows)}. Update the conflicting accounts' emails explicitly, then retry. No users, provider identities, or roles were changed; accounts are never merged.`);
  }
  await tx.execute(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique`);
  await tx.execute(sql`UPDATE users SET email = btrim(email) WHERE email IS DISTINCT FROM btrim(email)`);
  await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique ON users (lower(nullif(btrim(email::text), ''::text)))`);
}

const migration: Migration = {
  version: 1125,
  name: "user_email_identity",
  description: "Case-insensitive nonblank login email uniqueness without merging accounts",
  async up() {
    await db.transaction(migrateUserEmails);
  },
};
registerMigration(migration);
export default migration;
