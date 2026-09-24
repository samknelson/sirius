import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "dispatch";

/**
 * Create `dispatch_job_employer_contacts` (Task: Employer Contacts tab on
 * dispatch jobs) on deployments where the dispatch component is ALREADY
 * enabled — a fresh enable creates the table via component schema push, so
 * this is a no-op there.
 *
 * contact_id references contacts(id), NOT employer_contacts(id): removing a
 * contact from the employer must not clear existing job associations, while
 * deleting the job or the contact person cascades them away.
 *
 * Idempotent: skips creation when the table exists.
 */
async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'dispatch_job_employer_contacts'
    )
  `);
  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';
  if (exists) {
    logger.info("dispatch_job_employer_contacts already exists, skipping creation", {
      service: "migration-dispatch-003",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE dispatch_job_employer_contacts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id varchar NOT NULL REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
      contact_id varchar NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      data jsonb
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX dispatch_job_employer_contacts_job_contact_unique
      ON dispatch_job_employer_contacts (job_id, contact_id)
  `);

  logger.info("Created dispatch_job_employer_contacts table", {
    service: "migration-dispatch-003",
  });
}

const migration: Migration = {
  version: 3,
  name: "create_dispatch_job_employer_contacts",
  description:
    "Create the dispatch_job_employer_contacts table (job↔contact associations for the Employer Contacts tab). Idempotent: skips when the table already exists (fresh enables create it via component schema push).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
