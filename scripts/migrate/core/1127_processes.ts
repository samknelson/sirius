import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration } from "../../../server/services/boot/migration-runner";

registerMigration({
  version: 1127,
  name: "processes",
  description: "Observational inventory of backend process lifetimes",
  async up() {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS processes (
        id uuid PRIMARY KEY, name text, roles text[] NOT NULL,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        started_ts timestamptz NOT NULL, updated_ts timestamptz NOT NULL,
        ended_ts timestamptz
      );
      CREATE INDEX IF NOT EXISTS processes_active_start_idx ON processes (started_ts, id) WHERE ended_ts IS NULL;
      CREATE INDEX IF NOT EXISTS processes_expiry_idx ON processes (COALESCE(ended_ts, updated_ts));
    `);
  },
});
