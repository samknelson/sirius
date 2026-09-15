import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE denorm
      ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS denorm_config_status_stale_idx
      ON denorm (config_id, status, stale_at)
  `);
}

const migration: Migration = {
  version: 1189,
  name: "add_denorm_generation",
  description: "Add a monotonic denorm generation guard and bounded stale-drain index.",
  up,
};

registerMigration(migration);
export default migration;