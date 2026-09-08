import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const VARIABLE_NAME = "sitespecific.bao.appeal_workflow";

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("variables"))) {
    logger.info("variables does not exist, skipping retired grievance appeal workflow cleanup", {
      service: "migration-1151",
    });
    return;
  }
  const result = await db.execute(sql`
    DELETE FROM variables WHERE name = ${VARIABLE_NAME}
  `);
  logger.info(`Deleted ${result.rowCount ?? 0} retired grievance appeal workflow variables`, {
    service: "migration-1151",
  });
}

const migration: Migration = {
  version: 1151,
  name: "delete_grievance_appeal_workflow_variable",
  description: "Delete the retired sitespecific.bao.appeal_workflow variable when variables exists.",
  up,
};

registerMigration(migration);

export default migration;