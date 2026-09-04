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
  // Nullable with NO default on purpose: null is the third state, "the
  // worker has not answered yet", which is exactly what every existing
  // assignment is. A default would fabricate an answer nobody gave.
  if (!(await columnExists('accepted'))) {
    await db.execute(sql`
      ALTER TABLE edls_assignments
        ADD COLUMN accepted boolean
    `);
    logger.info("Added accepted column to edls_assignments", { service: "migration-edls-004" });
  } else {
    logger.info("edls_assignments.accepted already exists, skipping", { service: "migration-edls-004" });
  }
}

const migration: Migration = {
  version: 4,
  name: "add_assignment_accepted",
  description: "Add a nullable boolean accepted column to edls_assignments holding the worker's own answer to the assignment (null = unanswered, true = accepted, false = declined). No default: existing rows are unanswered. Idempotent: the column is added only when absent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
