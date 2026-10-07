import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

/** No byte movement or URL rewriting. Owner IDs are the existing file IDs. */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS template_assets (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid()
    )`);
    // Lock source records against concurrent ownership mutation during adoption.
    await tx.execute(sql`SELECT id FROM files WHERE entity_type = 'template-asset' FOR UPDATE`);
    const conflicts = await tx.execute(sql`
      SELECT f.id FROM files f JOIN entity_files e ON e.file_id = f.id
      WHERE f.entity_type = 'template-asset'
        AND (e.context_id <> 'template_asset' OR e.entity_id <> f.id)
    `);
    if (conflicts.rows.length) throw new Error("Legacy template image already belongs to another attachment; repair before adoption.");
    await tx.execute(sql`INSERT INTO template_assets (id)
      SELECT id FROM files WHERE entity_type = 'template-asset'
      ON CONFLICT (id) DO NOTHING`);
    await tx.execute(sql`INSERT INTO entity_files (context_id, entity_id, file_id, name)
      SELECT 'template_asset', id, id, left(file_name, 255)
      FROM files WHERE entity_type = 'template-asset'
      ON CONFLICT (file_id) DO NOTHING`);
    await tx.execute(sql`UPDATE files SET entity_type = 'entity-files:template_asset', entity_id = id
      WHERE entity_type = 'template-asset'`);
  });
}
const migration: Migration = {
  version: 1204, name: "adopt_template_assets",
  description: "Durable reusable owners and shared attachments for managed template images, preserving object locations.",
  up,
};
registerMigration(migration);
export default migration;
