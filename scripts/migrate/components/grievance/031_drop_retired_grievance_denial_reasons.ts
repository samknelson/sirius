import { sql } from "drizzle-orm";
import { db } from "../../../../server/db";
import { logger } from "../../../../server/logger";
import {
  registerComponentMigration,
  type Migration,
} from "../../../../server/services/migration-runner";

const COMPONENT_ID = "grievance";

async function up(): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS options_grievance_denial_reason
  `);

  logger.info("Dropped retired grievance denial-reason table", {
    service: "migration-grievance-031",
  });
}

const migration: Migration = {
  version: 31,
  name: "drop_retired_grievance_denial_reasons",
  description:
    "Drop the retired options_grievance_denial_reason table so databases that previously applied grievance migration 030 match the current component manifest. Idempotent.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;