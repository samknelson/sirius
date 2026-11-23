import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

async function up(): Promise<void> {
  // The daily explorer follows sheet date -> crews -> filled assignments.
  // EXPLAIN showed whole-table scans without these lookup indexes.
  await db.execute(sql`CREATE INDEX IF NOT EXISTS edls_sheets_ymd_idx ON edls_sheets (ymd)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS edls_crews_sheet_id_idx ON edls_crews (sheet_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS edls_assignments_crew_id_idx ON edls_assignments (crew_id)`);
}

const migration: Migration = {
  version: 9,
  name: "index_daily_assignment_scope",
  description: "Bound daily assignment reads by sheet date, crew membership, and filled assignment membership.",
  up,
};

registerComponentMigration("edls", migration);
export default migration;
