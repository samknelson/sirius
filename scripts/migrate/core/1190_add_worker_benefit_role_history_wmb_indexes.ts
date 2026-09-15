import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists
  `);
  return result.rows[0]?.exists === true || result.rows[0]?.exists === "t";
}

async function up(): Promise<void> {
  // trust_wmb is owned by optional trust.benefits. It may be absent when core
  // migrations run, in which case this performance-only index is unnecessary.
  if (!(await tableExists("trust_wmb"))) return;

  // The role-history drain looks up a receiver's own/dependent rows and rows
  // granted through each relation. These bounded indexes prevent each worker
  // recomputation from scanning a corrective scan's full WMB history.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS trust_wmb_worker_coverage_history_idx
      ON trust_wmb (worker_id, year, month)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS trust_wmb_source_relation_coverage_history_idx
      ON trust_wmb (source_relation_id, year, month)
  `);
}

const migration: Migration = {
  version: 1190,
  name: "add_worker_benefit_role_history_wmb_indexes",
  description: "Index WMB receiver and relation coverage lookups for the deferred role-history denorm drain.",
  up,
};

registerMigration(migration);
export default migration;