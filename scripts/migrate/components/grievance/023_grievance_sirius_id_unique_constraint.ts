import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

/**
 * Convert the grievances `sirius_id` uniqueness from a plain unique INDEX (as
 * created by migration 021) to a named UNIQUE CONSTRAINT
 * (`grievances_sirius_id_unique`). Drizzle's column-level `.unique()` declares a
 * constraint, and the startup schema-drift gate reflects constraints and indexes
 * separately — so the bare index left the constraint "missing" and refused boot.
 *
 * Idempotent: if the constraint already exists, do nothing. Otherwise drop the
 * plain index (safe — no constraint owns the name yet) so the constraint can
 * adopt it, then add the constraint. NULLs remain allowed; duplicate non-null
 * values are rejected.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'grievances_sirius_id_unique'
      ) THEN
        DROP INDEX IF EXISTS grievances_sirius_id_unique;
        ALTER TABLE grievances
          ADD CONSTRAINT grievances_sirius_id_unique UNIQUE (sirius_id);
      END IF;
    END $$;
  `);
  logger.info("Ensured grievances_sirius_id_unique constraint", {
    service: "migration-grievance-023",
  });
}

const migration: Migration = {
  version: 23,
  name: "grievance_sirius_id_unique_constraint",
  description:
    "Replace the grievances.sirius_id unique index (migration 021) with a named UNIQUE CONSTRAINT (grievances_sirius_id_unique) to match Drizzle's column-level .unique() and satisfy the startup drift gate. Idempotent: no-op if the constraint already exists.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
