import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "dispatch.fore";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'dispatch_job_fore'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("dispatch_job_fore table already exists, skipping creation", {
      service: "migration-dispatch.fore-001",
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE dispatch_job_fore (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id varchar NOT NULL REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
      worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      data jsonb,
      CONSTRAINT dispatch_job_fore_job_id_worker_id_unique UNIQUE (job_id, worker_id)
    )
  `);

  logger.info("Created dispatch_job_fore table", {
    service: "migration-dispatch.fore-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_dispatch_job_fore",
  description: "Create the dispatch_job_fore table owned by the dispatch.fore component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
