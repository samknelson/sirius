import { sql } from "drizzle-orm";
import { db } from "../../../../server/db";
import {
  registerComponentMigration,
  type Migration,
} from "../../../../server/services/migration-runner";

const COMPONENT_ID = "bulk";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE bulk_messages_postal
    ADD COLUMN IF NOT EXISTS body_html text
  `);
}

const migration: Migration = {
  version: 2,
  name: "add_postal_body_html",
  description:
    "Add the canonical authored HTML body to bulk postal message content.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;