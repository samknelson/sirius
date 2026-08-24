import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "edls";

async function columnExists(column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'edls_assignments'
        AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
}

async function up(): Promise<void> {
  // Nullable on purpose: nothing populates comm_id yet, and existing
  // assignments keep a null link. ON DELETE SET NULL means purging the comm
  // log clears the reference instead of deleting scheduling data.
  if (!(await columnExists('comm_id'))) {
    await db.execute(sql`
      ALTER TABLE edls_assignments
        ADD COLUMN comm_id varchar
        CONSTRAINT edls_assignments_comm_id_comm_id_fk
        REFERENCES comm(id) ON DELETE SET NULL
    `);
    logger.info("Added comm_id column to edls_assignments", { service: "migration-edls-003" });
  } else {
    logger.info("edls_assignments.comm_id already exists, skipping", { service: "migration-edls-003" });
  }
}

const migration: Migration = {
  version: 3,
  name: "add_assignment_comm_id",
  description: "Add a nullable comm_id column to edls_assignments with a foreign key to comm(id) ON DELETE SET NULL. Existing rows keep a null link and nothing populates the column yet. Idempotent: the column is added only when absent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
