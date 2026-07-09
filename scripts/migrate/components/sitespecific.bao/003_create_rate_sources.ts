import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-003";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("sitespecific_bao_rate_sources"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_rate_sources (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        type varchar NOT NULL,
        start_ymd date NOT NULL,
        data jsonb
      )
    `);
    logger.info("Created sitespecific_bao_rate_sources table", { service: SERVICE });
  }

  if (!(await tableExists("sitespecific_bao_rate_source_employers"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_rate_source_employers (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id varchar NOT NULL REFERENCES sitespecific_bao_rate_sources(id) ON DELETE CASCADE,
        employer_id varchar NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_rate_source_employers_source_employer_uq
          UNIQUE (source_id, employer_id)
      )
    `);
    logger.info("Created sitespecific_bao_rate_source_employers table", { service: SERVICE });
  }

  if (
    (await tableExists("sitespecific_bao_employer_rates")) &&
    !(await columnExists("sitespecific_bao_employer_rates", "source_id"))
  ) {
    await db.execute(sql`
      ALTER TABLE sitespecific_bao_employer_rates
        ADD COLUMN source_id varchar REFERENCES sitespecific_bao_rate_sources(id) ON DELETE SET NULL
    `);
    logger.info("Added source_id column to sitespecific_bao_employer_rates", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 3,
  name: "create_bao_rate_sources",
  description:
    "Create the sitespecific_bao_rate_sources and sitespecific_bao_rate_source_employers tables (benefit rate sources: contracts / rate letters and their employer associations), and add a nullable source_id column to sitespecific_bao_employer_rates. Idempotent: each step checks for existence first (the enable flow may create the new tables via component schema push).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
