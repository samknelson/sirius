import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration } from "../../../server/services/migration-runner";

registerMigration({
  version: 1128,
  name: "semaphores",
  description: "Short-transaction ownership leases for cron coordination",
  async up() {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS semaphores (
      key text PRIMARY KEY,
      owner_process_id uuid,
      ownership_token uuid,
      expires_at timestamptz,
      CONSTRAINT semaphores_ownership_complete CHECK (
        (owner_process_id IS NULL AND ownership_token IS NULL AND expires_at IS NULL)
        OR (owner_process_id IS NOT NULL AND ownership_token IS NOT NULL AND expires_at IS NOT NULL)
      )
    )`);
  },
});
