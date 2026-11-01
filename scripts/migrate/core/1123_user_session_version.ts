import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1123,
  name: "user_session_version",
  description: "Durable account session revocation generation",
  async up() {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0`);
  },
};
registerMigration(migration);
export default migration;
