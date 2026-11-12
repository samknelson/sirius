import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "edls";

async function up(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS edls_assignments_worker_id_ymd_idx
      ON edls_assignments (worker_id, ymd)
  `);
  logger.info("Added worker/date index to EDLS assignments", {
    service: "migration-edls-007",
  });
}

const migration: Migration = {
  version: 7,
  name: "index_assignments_by_worker_date",
  description:
    "Index EDLS assignments by worker and date so worker-directory assignment status and date filters use a bounded indexed access path.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;