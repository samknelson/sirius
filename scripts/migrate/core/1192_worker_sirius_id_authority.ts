import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { workerSiriusIdDefaultFunctionSql } from "../../../server/services/worker-sirius-id-default-sql";

async function up(): Promise<void> {
  // Preserve both the existing values and the sequence.  Only future omitted
  // values change behavior: under the fail-safe external authority they are
  // NULL; after an explicit S2 cutover the database function allocates one.
  await db.execute(sql.raw(workerSiriusIdDefaultFunctionSql));
  await db.execute(sql`
    ALTER TABLE workers
      ALTER COLUMN sirius_id DROP NOT NULL,
      ALTER COLUMN sirius_id SET DEFAULT worker_sirius_id_default()
  `);
}

const migration: Migration = {
  version: 1192,
  name: "worker_sirius_id_authority",
  description: "Make worker Sirius IDs nullable and gate database-side allocation behind explicit S2 authority.",
  up,
};

registerMigration(migration);
export default migration;