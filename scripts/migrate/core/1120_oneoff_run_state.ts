import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      ALTER TABLE job_runs
        ADD COLUMN IF NOT EXISTS input jsonb,
        ADD COLUMN IF NOT EXISTS progress jsonb,
        ADD COLUMN IF NOT EXISTS checkpoint jsonb,
        ADD COLUMN IF NOT EXISTS heartbeat_at timestamp,
        ADD COLUMN IF NOT EXISTS cancel_requested boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS confirmation_hash text,
        ADD COLUMN IF NOT EXISTS confirmation_used_at timestamp
    `);
    await tx.execute(sql`UPDATE job_runs SET cancel_requested = false WHERE cancel_requested IS NULL`);
    await tx.execute(sql`
      ALTER TABLE job_runs
        ALTER COLUMN cancel_requested SET DEFAULT false,
        ALTER COLUMN cancel_requested SET NOT NULL
    `);
  });
}

const migration: Migration = {
  version: 1120,
  name: "oneoff_run_state",
  description: "Add durable Oneoff progress, cancellation, heartbeat and confirmation state",
  up,
};
registerMigration(migration);
export default migration;