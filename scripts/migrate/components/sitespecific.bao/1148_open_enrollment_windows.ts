import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import {
  registerComponentMigration,
  type Migration,
} from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const TABLE = "open_enrollment_windows";
const SERVICE = "migration-sitespecific.bao-1148";

async function tableExists(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${TABLE}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (await tableExists()) {
    logger.info("Adopted existing Open Enrollment windows without changing rows", {
      service: SERVICE,
    });
    return;
  }

  await db.execute(sql`
    CREATE TABLE open_enrollment_windows (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_year integer NOT NULL UNIQUE,
      start_ymd date NOT NULL,
      end_ymd date NOT NULL,
      notes varchar,
      data jsonb
    )
  `);
  logger.info("Created Open Enrollment windows table for BAO", {
    service: SERVICE,
  });
}

const migration: Migration = {
  version: 1148,
  name: "open_enrollment_windows",
  description:
    "Adopt an existing open_enrollment_windows table without modifying its rows, or create it for a fresh BAO enablement.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
