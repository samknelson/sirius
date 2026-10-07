import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 2,
  name: "add_device_id",
  description: "Retain the verified browser-profile UUID on session history observations.",
  async up(): Promise<void> {
    // Fresh enablement may already have pushed the current schema.
    // Existing observations deliberately remain NULL.
    await db.execute(sql`ALTER TABLE session_history ADD COLUMN IF NOT EXISTS device_id uuid`);
  },
};

registerComponentMigration("system.session_history", migration);

export default migration;
