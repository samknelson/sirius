import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE denorm
      ADD COLUMN IF NOT EXISTS claim_token varchar,
      ADD COLUMN IF NOT EXISTS claim_at timestamp
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS denorm_stale_claim_idx
      ON denorm (config_id, status, claim_at, stale_at)
  `);
}

const migration: Migration = {
  version: 1191,
  name: "add_denorm_claim_lease",
  description: "Add expiring denorm drain claims so concurrent processors cannot apply or error the same generation.",
  up,
};

registerMigration(migration);
export default migration;