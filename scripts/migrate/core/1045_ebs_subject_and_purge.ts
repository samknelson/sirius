import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * EBS follow-up columns:
 *   - `ebs_denorm.subject_id` (+ index): the owning subject a scheduled event is
 *     about (e.g. the worker), so the bus can be operated at subject granularity.
 *   - `ebs_status.purge_after` (+ index): a per-row purge cutoff derived from the
 *     source event's `dont_send_after`, replacing the old `created_at`-age purge.
 *     The old `ebs_status_created_idx` is dropped (the purge no longer scans
 *     `created_at`; the column itself is kept for audit).
 *
 * Both tables are created empty by migration 1044, so the NOT NULL columns are
 * added without a default. Idempotent via IF (NOT) EXISTS guards.
 */
async function up(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE ebs_denorm ADD COLUMN IF NOT EXISTS subject_id varchar NOT NULL`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS ebs_denorm_subject_idx ON ebs_denorm (subject_id)`,
  );

  await db.execute(
    sql`ALTER TABLE ebs_status ADD COLUMN IF NOT EXISTS purge_after timestamp NOT NULL`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS ebs_status_purge_idx ON ebs_status (purge_after)`,
  );
  await db.execute(sql`DROP INDEX IF EXISTS ebs_status_created_idx`);

  logger.info("Added ebs_denorm.subject_id and ebs_status.purge_after", {
    service: "migration-1045",
  });
}

const migration: Migration = {
  version: 1045,
  name: "ebs_subject_and_purge",
  description:
    "Add ebs_denorm.subject_id (indexed owning-subject id) and ebs_status.purge_after (row-safe purge cutoff derived from dont_send_after, replacing the created_at-age purge); drop the now-unused ebs_status_created_idx.",
  up,
};

registerMigration(migration);

export default migration;
