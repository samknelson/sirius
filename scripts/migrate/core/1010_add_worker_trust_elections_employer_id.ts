import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function up(): Promise<void> {
  const tableCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'worker_trust_elections'
    ) AS exists
  `);
  const hasTable = tableCheck.rows[0]?.exists === true || tableCheck.rows[0]?.exists === 't';
  if (!hasTable) {
    logger.info("worker_trust_elections table missing; skipping", {
      service: "migration-1010",
    });
    return;
  }

  const colCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'worker_trust_elections' AND column_name = 'employer_id'
    ) AS exists
  `);
  const hasColumn = colCheck.rows[0]?.exists === true || colCheck.rows[0]?.exists === 't';
  if (!hasColumn) {
    await db.execute(sql`
      ALTER TABLE worker_trust_elections ADD COLUMN employer_id varchar
    `);
    logger.info("Added employer_id column to worker_trust_elections", {
      service: "migration-1010",
    });
  }

  // Backfill any rows that still have a NULL employer_id with the first
  // active employer (by name). Required so we can enforce NOT NULL below.
  await db.execute(sql`
    UPDATE worker_trust_elections
    SET employer_id = (
      SELECT id FROM employers WHERE is_active = true ORDER BY name ASC LIMIT 1
    )
    WHERE employer_id IS NULL
  `);

  const stillNull = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM worker_trust_elections WHERE employer_id IS NULL
    ) AS exists
  `);
  const hasNulls = stillNull.rows[0]?.exists === true || stillNull.rows[0]?.exists === 't';
  if (hasNulls) {
    throw new Error(
      "Cannot enforce NOT NULL on worker_trust_elections.employer_id: rows remain with NULL employer_id and no active employer exists to backfill them.",
    );
  }

  // Enforce NOT NULL (idempotent — ALTER is a no-op if already set).
  await db.execute(sql`
    ALTER TABLE worker_trust_elections ALTER COLUMN employer_id SET NOT NULL
  `);

  const fkCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'worker_trust_elections'::regclass
        AND conname = 'worker_trust_elections_employer_id_employers_id_fk'
    ) AS exists
  `);
  const hasFk = fkCheck.rows[0]?.exists === true || fkCheck.rows[0]?.exists === 't';
  if (!hasFk) {
    await db.execute(sql`
      ALTER TABLE worker_trust_elections
      ADD CONSTRAINT worker_trust_elections_employer_id_employers_id_fk
      FOREIGN KEY (employer_id) REFERENCES employers(id) ON DELETE RESTRICT
    `);
    logger.info("Added FK worker_trust_elections_employer_id_employers_id_fk", {
      service: "migration-1010",
    });
  }
}

const migration: Migration = {
  version: 1010,
  name: "add_worker_trust_elections_employer_id",
  description:
    "Add required employer_id (FK to employers, ON DELETE RESTRICT) to worker_trust_elections",
  up,
};

registerMigration(migration);
