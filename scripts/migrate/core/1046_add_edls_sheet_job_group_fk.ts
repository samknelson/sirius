import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='edls_sheets') AS has_edls,
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dispatch_job_group') AS has_djg
  `);
  const row: { has_edls?: boolean | string; has_djg?: boolean | string } = tableCheck.rows[0] ?? {};
  const hasEdls = row.has_edls === true || row.has_edls === 't';
  const hasDjg = row.has_djg === true || row.has_djg === 't';
  if (!hasEdls || !hasDjg) {
    logger.info("Required tables missing (edls_sheets or dispatch_job_group); component not enabled, skipping", {
      service: "migration-1046",
      hasEdls,
      hasDjg,
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'edls_sheets' AND column_name = 'job_group_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    logger.info("edls_sheets.job_group_id column missing; nothing to constrain, skipping", {
      service: "migration-1046",
    });
    return;
  }

  const fkCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.conrelid = 'edls_sheets'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'dispatch_job_group'::regclass
        AND a.attname = 'job_group_id'
    ) AS exists
  `);
  const hasFk = fkCheck.rows[0]?.exists === true || fkCheck.rows[0]?.exists === 't';
  if (hasFk) {
    logger.info("edls_sheets.job_group_id -> dispatch_job_group FK already exists, skipping", {
      service: "migration-1046",
    });
    return;
  }

  // Null out any orphaned references so adding the constraint cannot fail.
  // This matches the schema's ON DELETE SET NULL semantics.
  await db.execute(sql`
    UPDATE edls_sheets s
    SET job_group_id = NULL
    WHERE s.job_group_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dispatch_job_group g WHERE g.id = s.job_group_id)
  `);

  await db.execute(sql`
    ALTER TABLE edls_sheets
    ADD CONSTRAINT edls_sheets_job_group_id_fkey
    FOREIGN KEY (job_group_id) REFERENCES dispatch_job_group(id) ON DELETE SET NULL
  `);

  logger.info("Added job_group_id -> dispatch_job_group FK to edls_sheets", {
    service: "migration-1046",
  });
}

const migration: Migration = {
  version: 1046,
  name: "add_edls_sheet_job_group_fk",
  description: "Add job_group_id -> dispatch_job_group FK to edls_sheets (repairs DBs where migration 005 ran before the dispatch job-group table existed)",
  up,
};

registerMigration(migration);
