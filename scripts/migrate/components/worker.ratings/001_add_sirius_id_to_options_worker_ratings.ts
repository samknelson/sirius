import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "worker.ratings";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function constraintExists(table: string, constraint: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = ${table}::regclass AND conname = ${constraint}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Add an optional unique `sirius_id` column to options_worker_ratings.
 *
 * - `sirius_id`: nullable varchar; multiple NULLs are allowed, non-null
 *   values must be unique (enforced by the named unique constraint so the
 *   reflected DDL matches the Drizzle `.unique()` declaration).
 *
 * Idempotent: skips the column/constraint if it already exists.
 */
async function up(): Promise<void> {
  if (!(await columnExists("options_worker_ratings", "sirius_id"))) {
    await db.execute(sql`
      ALTER TABLE options_worker_ratings ADD COLUMN sirius_id varchar
    `);
    logger.info("Added sirius_id column to options_worker_ratings", {
      service: "migration-worker.ratings-001",
    });
  } else {
    logger.info("options_worker_ratings.sirius_id already exists, skipping", {
      service: "migration-worker.ratings-001",
    });
  }

  if (!(await constraintExists("options_worker_ratings", "options_worker_ratings_sirius_id_unique"))) {
    await db.execute(sql`
      ALTER TABLE options_worker_ratings
      ADD CONSTRAINT options_worker_ratings_sirius_id_unique UNIQUE (sirius_id)
    `);
    logger.info("Added unique constraint options_worker_ratings_sirius_id_unique", {
      service: "migration-worker.ratings-001",
    });
  } else {
    logger.info("options_worker_ratings_sirius_id_unique already exists, skipping", {
      service: "migration-worker.ratings-001",
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "add_sirius_id_to_options_worker_ratings",
  description:
    "Add optional unique sirius_id column to options_worker_ratings. Nullable; non-null values unique via named constraint. Idempotent: skips column/constraint that already exist.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
