import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-004";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("sitespecific_bao_distance_cache"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_distance_cache (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        origin_lat numeric(9,5) NOT NULL,
        origin_lng numeric(9,5) NOT NULL,
        dest_lat numeric(9,5) NOT NULL,
        dest_lng numeric(9,5) NOT NULL,
        distance_miles numeric(10,4) NOT NULL,
        method varchar NOT NULL,
        computed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sitespecific_bao_distance_cache_coords_uq
          UNIQUE (origin_lat, origin_lng, dest_lat, dest_lng)
      )
    `);
    logger.info("Created sitespecific_bao_distance_cache table", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 4,
  name: "create_bao_distance_cache",
  description:
    "Create the sitespecific_bao_distance_cache table (persistent cache of measured worker↔site geographic distances, keyed on rounded origin/destination coordinates, recording the derivation method and computed-at). Idempotent: skips creation if the table already exists (the enable flow creates it via component schema push first).",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
