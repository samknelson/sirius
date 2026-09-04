import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Outbound web-client call counter: `wc_stats`.
 *
 * One row per (service, request_type, day) counting the calls we actually
 * made. `day` is a Ymd string, not a timestamp, so a day reads back as the
 * same day however it is read; the day a call is attributed to is the server's
 * local day, from the same helper the rest of the app uses to name "today".
 *
 * The uniqueness tuple is a named UNIQUE CONSTRAINT (matching the Drizzle
 * `unique()` declaration the drift gate reflects) and is also the conflict
 * target of the insert-or-increment, so concurrent calls cannot lose counts.
 *
 * Idempotent: the table is created only if it is absent.
 */
async function up(): Promise<void> {
  if (!(await tableExists("wc_stats"))) {
    await db.execute(sql`
      CREATE TABLE wc_stats (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        service varchar(64) NOT NULL,
        request_type varchar(64) NOT NULL,
        day varchar(10) NOT NULL,
        calls integer NOT NULL DEFAULT 0,
        CONSTRAINT wc_stats_service_type_day_uniq UNIQUE (service, request_type, day)
      )
    `);
    logger.info("Created wc_stats table", { service: "migration-1139" });
  } else {
    logger.info("wc_stats table already exists, skipping", {
      service: "migration-1139",
    });
  }
}

const migration: Migration = {
  version: 1139,
  name: "create_wc_stats",
  description:
    "Create wc_stats, the per-day counter of outbound web client calls (one row per service + request_type + day, unique on that tuple as a named constraint so the insert-or-increment has a conflict target). Counts calls actually made to a vendor, including request types whose behavior is uncached and therefore write nothing to wc_cache.",
  up,
};

registerMigration(migration);

export default migration;
