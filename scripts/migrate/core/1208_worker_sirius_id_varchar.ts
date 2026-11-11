import { sql, type SQL } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { workerSiriusIdVarcharDefaultFunctionSql } from "../../../server/services/worker-sirius-id-default-sql";

export async function applyWorkerSiriusIdVarcharMigration(tx: {
  execute(query: SQL): Promise<unknown>;
}): Promise<void> {
  // Drop the old return-type-bound default before recreating the function with
  // its text result. The caller keeps conversion and default restoration atomic.
  await tx.execute(sql`ALTER TABLE workers ALTER COLUMN sirius_id DROP DEFAULT`);
  await tx.execute(sql`DROP FUNCTION IF EXISTS worker_sirius_id_default()`);
  await tx.execute(sql`
    ALTER TABLE workers
    ALTER COLUMN sirius_id TYPE varchar USING sirius_id::varchar
  `);
  await tx.execute(sql.raw(workerSiriusIdVarcharDefaultFunctionSql));
  await tx.execute(sql`
    ALTER TABLE workers ALTER COLUMN sirius_id SET DEFAULT worker_sirius_id_default()
  `);
}

async function up(): Promise<void> {
  await db.transaction(applyWorkerSiriusIdVarcharMigration);
}

const migration: Migration = {
  version: 1208,
  name: "worker_sirius_id_varchar",
  description: "Convert worker Sirius IDs to varchar while preserving values and policy-gated allocation.",
  up,
};

registerMigration(migration);
export default migration;
