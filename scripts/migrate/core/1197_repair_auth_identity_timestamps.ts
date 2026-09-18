import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1197,
  name: "repair_auth_identity_timestamps",
  description:
    "Restore nullable auth identity timestamps with database defaults after a database refresh.",
  async up() {
    await db.execute(sql`
      DO $$
      BEGIN
        IF to_regclass('public.auth_identities') IS NOT NULL THEN
          ALTER TABLE auth_identities
            ADD COLUMN IF NOT EXISTS created_at timestamp,
            ADD COLUMN IF NOT EXISTS updated_at timestamp;
          ALTER TABLE auth_identities
            ALTER COLUMN created_at SET DEFAULT now(),
            ALTER COLUMN created_at DROP NOT NULL,
            ALTER COLUMN updated_at SET DEFAULT now(),
            ALTER COLUMN updated_at DROP NOT NULL;
        END IF;
      END $$;
    `);
  },
};

registerMigration(migration);

export default migration;