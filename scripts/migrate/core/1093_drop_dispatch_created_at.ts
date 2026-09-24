import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

/**
 * Drop `dispatch_jobs.created_at` and `dispatches.created_at`.
 *
 * `entity_metadata` is now the single answer to "when was this made, and by
 * whom" for both tables: migration 1092 seeded it from these columns, the
 * storage logging middleware maintains it on every save, and the job details
 * page reads it. Keeping the columns would keep a second, person-less answer
 * that only the rows written before the framework ever agreed with.
 *
 * Nothing else read them — no dispatch API response, event payload, or
 * eligibility/bullpen/listing path — except the job list's newest-first
 * ordering, which now sorts on the provenance date instead.
 *
 * Guarded per column rather than assumed: both tables belong to the optional
 * `dispatch` component and do not exist at all on a deployment where it is
 * off, and a core migration that dies on a missing table stops that
 * deployment's boot. The check also makes the migration re-runnable.
 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  let dropped = 0;

  if (await columnExists("dispatch_jobs", "created_at")) {
    await db.execute(sql`ALTER TABLE dispatch_jobs DROP COLUMN IF EXISTS created_at`);
    dropped += 1;
  }

  if (await columnExists("dispatches", "created_at")) {
    await db.execute(sql`ALTER TABLE dispatches DROP COLUMN IF EXISTS created_at`);
    dropped += 1;
  }

  logger.info("Dropped bespoke dispatch created_at columns", {
    service: "migration-1093",
    dropped,
  });
}

const migration: Migration = {
  version: 1093,
  name: "drop_dispatch_created_at",
  description:
    "Drop the bespoke created_at columns from dispatch_jobs and dispatches now that entity_metadata holds their creation stamps (seeded by migration 1092, maintained by the storage logging middleware, and read by the job details page). Each drop is guarded by a column-existence check because both tables belong to the optional dispatch component and are absent where it is disabled.",
  up,
};

registerMigration(migration);

export default migration;
