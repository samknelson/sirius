import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "grievance";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function constraintExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Add a nullable `employer_contact_id` varchar column to the grievances table,
 * referencing the core `contacts` table with ON DELETE SET NULL. Records the
 * optional "Company Representative" — the employer contact responsible for
 * responding to the grievance. There is intentionally no enforcement that the
 * chosen contact belongs to the grievance's employer. Existing rows backfill to
 * NULL automatically.
 *
 * Idempotent: skips the column add and the constraint add if they already
 * exist, so a re-run is safe.
 */
async function up(): Promise<void> {
  if (!(await columnExists("grievances", "employer_contact_id"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD COLUMN "employer_contact_id" varchar
    `);
    logger.info("Added employer_contact_id column to grievances", {
      service: "migration-grievance-026",
    });
  } else {
    logger.info("grievances.employer_contact_id already exists, skipping", {
      service: "migration-grievance-026",
    });
  }

  if (!(await constraintExists("grievances_employer_contact_id_contacts_id_fk"))) {
    await db.execute(sql`
      ALTER TABLE grievances
      ADD CONSTRAINT grievances_employer_contact_id_contacts_id_fk
      FOREIGN KEY ("employer_contact_id") REFERENCES contacts (id)
      ON DELETE SET NULL
    `);
    logger.info("Added employer_contact_id FK constraint to grievances", {
      service: "migration-grievance-026",
    });
  } else {
    logger.info("grievances employer_contact_id FK already exists, skipping", {
      service: "migration-grievance-026",
    });
  }
}

const migration: Migration = {
  version: 26,
  name: "add_employer_contact_id_to_grievances",
  description:
    "Add a nullable employer_contact_id varchar column to grievances referencing core contacts (ON DELETE SET NULL). Records the optional Company Representative; no enforcement that the contact belongs to the employer. Existing rows backfill to NULL. Idempotent: skips the column and constraint adds if present.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
