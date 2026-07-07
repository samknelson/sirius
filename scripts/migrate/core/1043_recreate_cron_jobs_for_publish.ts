import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * TEMPORARY publish-migration workaround (July 2026).
 *
 * The Publish flow diffs the dev DB against prod and generated a script that
 * ran `DROP TABLE cron_jobs CASCADE` BEFORE `ALTER TABLE cron_job_runs DROP
 * CONSTRAINT cron_job_runs_job_name_cron_jobs_name_fk`. The CASCADE removes
 * that FK, so the explicit DROP CONSTRAINT then fails and the whole publish
 * migration rolls back — every publish attempt fails the same way.
 *
 * Fix is a two-step publish:
 *  1. This migration recreates `cron_jobs` in dev (exact PRODUCTION shape,
 *     WITHOUT the cron_job_runs FK, which dev already dropped in 1034). The
 *     next publish then only drops the FK in prod (plus all unrelated
 *     changes) and leaves the table.
 *  2. A follow-up migration drops `cron_jobs` again (and the schema entry is
 *     removed); the publish after that drops the prod table cleanly, since
 *     no FK remains.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS. The table stays empty and unused.
 */
async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      name text PRIMARY KEY,
      description text,
      schedule text NOT NULL,
      is_enabled boolean DEFAULT false NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL,
      settings jsonb
    )
  `);
  logger.info("Recreated legacy cron_jobs table (publish workaround, step 1 of 2)", {
    service: "migration-1043",
  });
}

const migration: Migration = {
  version: 1043,
  name: "recreate_cron_jobs_for_publish",
  description:
    "Temporarily recreate the legacy cron_jobs table (prod shape, no FK) so the Publish diff drops only the cron_job_runs FK in prod; a follow-up migration will drop the table again for the second publish.",
  up,
};

registerMigration(migration);

export default migration;
