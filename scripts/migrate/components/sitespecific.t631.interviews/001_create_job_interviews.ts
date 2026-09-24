import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.t631.interviews";

async function up(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'sitespecific_t631_job_interviews'
    )
  `);

  const exists = result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === 't';

  if (exists) {
    logger.info("sitespecific_t631_job_interviews table already exists, skipping creation", {
      service: "migration-sitespecific.t631.interviews-001",
    });
    return;
  }

  // Enum is created only if missing (CREATE TYPE has no IF NOT EXISTS).
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sitespecific_t631_job_interview_status') THEN
        CREATE TYPE sitespecific_t631_job_interview_status AS ENUM ('offered', 'accepted', 'declined', 'passed', 'failed');
      END IF;
    END $$
  `);

  await db.execute(sql`
    CREATE TABLE sitespecific_t631_job_interviews (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
      job_id varchar NOT NULL REFERENCES dispatch_jobs(id) ON DELETE CASCADE,
      status sitespecific_t631_job_interview_status NOT NULL,
      data jsonb,
      CONSTRAINT st631_job_interviews_job_worker_unique UNIQUE (job_id, worker_id)
    )
  `);

  await db.execute(sql`
    CREATE INDEX idx_st631_job_interviews_worker_id ON sitespecific_t631_job_interviews (worker_id)
  `);

  logger.info("Created sitespecific_t631_job_interviews table", {
    service: "migration-sitespecific.t631.interviews-001",
  });
}

const migration: Migration = {
  version: 1,
  name: "create_job_interviews",
  description:
    "Create the sitespecific_t631_job_interviews table (and its status enum) owned by the sitespecific.t631.interviews component. Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
