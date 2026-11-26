import { sql } from "drizzle-orm";
import { db } from "../../../../../../server/db";
import { registerComponentMigration, type Migration } from "../../../../../../server/services/boot/migration-runner";

const migration: Migration = {
  version: 1,
  name: "create_bookmarks",
  description: "Create the bookmark table on first installation; adopt existing records unchanged.",
  async up() {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type text NOT NULL,
        entity_id varchar NOT NULL
      )
    `);
  },
};
registerComponentMigration("bookmark", migration);
export default migration;
