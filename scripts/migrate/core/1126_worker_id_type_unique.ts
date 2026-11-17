import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function migrateWorkerIdTypes(tx: Transaction): Promise<void> {
  // Explicitly approved destructive cleanup across ALL types. The user rejected
  // a refusal/manual-cleanup prerequisite and requested arbitrary deduplication.
  // The survivor is not necessarily current. T631 can correct a retained EIN
  // only if its source worker_id still matches the retained local t631 ID;
  // deleting that source identity can require a later operator correction.
  // Do not guess cross-worker identity or consult remote services during boot.
  await tx.execute(sql`LOCK TABLE worker_ids IN ACCESS EXCLUSIVE MODE`);
  const removed = await tx.execute(sql`
    DELETE FROM worker_ids WHERE id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY worker_id, type_id ORDER BY id) AS position
        FROM worker_ids
      ) duplicates WHERE position > 1
    ) RETURNING id
  `);
  console.info(`Worker ID upgrade removed ${removed.rows.length} duplicate rows.`);
  await tx.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'worker_ids'::regclass
          AND conname = 'worker_ids_worker_id_type_id_unique'
      ) THEN
        ALTER TABLE worker_ids ADD CONSTRAINT worker_ids_worker_id_type_id_unique UNIQUE (worker_id, type_id);
      END IF;
    END $$
  `);
}

const migration: Migration = {
  version: 1126,
  name: "worker_id_type_unique",
  description: "Automatically remove duplicate worker/type IDs and enforce one per type",
  async up() { await db.transaction(migrateWorkerIdTypes); },
};
registerMigration(migration);
export default migration;
