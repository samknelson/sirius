import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Create `grievance_files` — the join table linking a grievance to its file
 * attachments (generic entity-files framework pilot).
 *
 * - `file_id` → files(id) UNIQUE + ON DELETE CASCADE: a files row belongs to
 *   at most one grievance attachment; deleting the files row removes the link.
 * - `grievance_id` → grievances(id) ON DELETE CASCADE.
 * - `name` — user-editable display name; `data` — freeform jsonb.
 *
 * Idempotent: skips the create when the table already exists.
 */
async function up(): Promise<void> {
  if (await tableExists("grievance_files")) {
    logger.info("grievance_files already exists, skipping create", {
      service: "migration-grievance-029",
    });
    return;
  }
  await db.execute(sql`
    CREATE TABLE grievance_files (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "grievance_id" varchar NOT NULL,
      "file_id" varchar NOT NULL,
      "name" varchar(255) NOT NULL,
      "data" jsonb,
      CONSTRAINT grievance_files_grievance_id_grievances_id_fk
        FOREIGN KEY ("grievance_id") REFERENCES grievances (id) ON DELETE CASCADE,
      CONSTRAINT grievance_files_file_id_files_id_fk
        FOREIGN KEY ("file_id") REFERENCES files (id) ON DELETE CASCADE,
      CONSTRAINT grievance_files_file_id_unique UNIQUE ("file_id")
    )
  `);
  logger.info("Created grievance_files table", {
    service: "migration-grievance-029",
  });
}

const migration: Migration = {
  version: 29,
  name: "create_grievance_files",
  description:
    "Create grievance_files — join table for grievance file attachments (file_id UNIQUE FK→files cascade, grievance_id FK→grievances cascade, display name, data jsonb). Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
