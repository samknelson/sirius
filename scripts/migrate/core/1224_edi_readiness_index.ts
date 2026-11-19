import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1224,
  name: "edi_readiness_index",
  description: "Bound EDI readiness population reads by benefit and calendar month.",
  async up() {
    // trust_wmb belongs to the optional trust.benefits component.
    const result = await db.execute(sql`SELECT to_regclass('public.trust_wmb') IS NOT NULL AS present`);
    if (!result.rows[0]?.present) return;
    await db.execute(sql`CREATE INDEX IF NOT EXISTS trust_wmb_benefit_calendar_worker_idx
      ON trust_wmb (benefit_id, year, month, worker_id)`);
  },
};
registerMigration(migration);
export default migration;
