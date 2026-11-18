import { sql, type SQL } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

export async function addPostalStreet2(client: { execute(query: SQL): Promise<unknown> }): Promise<void> {
  await client.execute(sql`ALTER TABLE contact_postal ADD COLUMN IF NOT EXISTS street2 text`);
}

const migration: Migration = {
  version: 1223,
  name: "contact_postal_street2",
  description: "Add nullable second address line without rewriting historical street text.",
  async up() {
    await addPostalStreet2(db);
  },
};
registerMigration(migration);
export default migration;
