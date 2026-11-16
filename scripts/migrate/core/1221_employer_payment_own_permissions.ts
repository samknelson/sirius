import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1221,
  name: "employer_payment_own_permissions",
  description: "Replace employer payment grants with own-scoped permissions covering every current contact assignment.",
  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
      // Preserve role membership and existing new-key assignments/timestamps.
      // No roles or user permissions are inferred from legacy grant flags.
      await tx.execute(sql`
        INSERT INTO role_permissions (role_id, permission_key, assigned_at)
        SELECT role_id,
          CASE permission_key
            WHEN 'employer.ledger.pay' THEN 'employer.ledger.pay.own'
            WHEN 'employer.ledger.methods' THEN 'employer.ledger.methods.manage.own'
          END,
          assigned_at
        FROM role_permissions
        WHERE permission_key IN ('employer.ledger.pay', 'employer.ledger.methods')
        ON CONFLICT (role_id, permission_key) DO NOTHING
      `);
      await tx.execute(sql`
        DELETE FROM role_permissions
        WHERE permission_key IN ('employer.ledger.pay', 'employer.ledger.methods')
      `);
      // Intentionally no CASCADE and no audit/metadata cleanup. Financial
      // records and the historical logs of former grants remain untouched.
      await tx.execute(sql`DROP TABLE IF EXISTS employer_contact_payment_grants`);
    });
  },
};

registerMigration(migration);
export default migration;
