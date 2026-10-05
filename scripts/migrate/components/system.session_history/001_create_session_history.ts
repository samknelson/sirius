import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 1,
  name: "create_session_history",
  description: "Create component-owned session history with independent session IDs and nullable cascading user references.",
  async up(): Promise<void> {
    // The enable-path schema push may already have created the table.
    // Leave the FK unnamed to match the push's Postgres-default FK name.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS session_history (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        sid varchar NOT NULL,
        user_id varchar REFERENCES users(id) ON DELETE CASCADE,
        ip varchar(45),
        timestamp timestamp NOT NULL DEFAULT now(),
        data jsonb
      )
    `);
  },
};

registerComponentMigration("system.session_history", migration);

export default migration;
