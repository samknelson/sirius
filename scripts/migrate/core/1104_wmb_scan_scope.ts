import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Employer-scoped benefit scans (Task: employer-scoped WMB scan runs).
 *
 * - `trust_wmb_scan_status` gains a scope: `scope_type` ('all' | 'employer',
 *   default 'all' so existing rows keep their meaning) and a nullable
 *   `scope_employer_id` FK to employers (cascade delete).
 * - The one-run-per-month unique constraint on (month, year) is dropped so a
 *   full run and employer-scoped runs can coexist for the same month.
 * - `trust_wmb_scan_queue` uniqueness moves from (worker_id, year, month) to
 *   (status_id, worker_id): a worker appears at most once per RUN, but the
 *   same worker/month can appear across multiple runs.
 *
 * Idempotent: IF NOT EXISTS / IF EXISTS guards on every statement (the
 * migration runner does not wrap up() in a transaction).
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE trust_wmb_scan_status ADD COLUMN IF NOT EXISTS scope_type varchar NOT NULL DEFAULT 'all'`,
  );
  await db.execute(
    sql`ALTER TABLE trust_wmb_scan_status ADD COLUMN IF NOT EXISTS scope_employer_id varchar REFERENCES employers(id) ON DELETE CASCADE`,
  );
  await db.execute(
    sql`ALTER TABLE trust_wmb_scan_status DROP CONSTRAINT IF EXISTS trust_wmb_scan_status_month_year_unique`,
  );
  await db.execute(
    sql`ALTER TABLE trust_wmb_scan_queue DROP CONSTRAINT IF EXISTS trust_wmb_scan_queue_worker_id_year_month_unique`,
  );
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trust_wmb_scan_queue_status_id_worker_id_unique'
      ) THEN
        ALTER TABLE trust_wmb_scan_queue
          ADD CONSTRAINT trust_wmb_scan_queue_status_id_worker_id_unique
          UNIQUE (status_id, worker_id);
      END IF;
    END $$;
  `);
  logger.info("Applied WMB scan scope schema changes", {
    service: "migration-1104",
  });
}

const migration: Migration = {
  version: 1104,
  name: "wmb_scan_scope",
  description:
    "Add scope (scope_type + scope_employer_id) to trust_wmb_scan_status, drop the one-run-per-month unique, and move trust_wmb_scan_queue uniqueness to (status_id, worker_id) so employer-scoped runs can coexist with full runs.",
  up,
};

registerMigration(migration);

export default migration;
