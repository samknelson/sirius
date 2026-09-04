import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1141";

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
 * Inbound web-service call counter: `ws_stats`.
 *
 * One row per (plugin, client, operation, day) counting the calls that reached
 * a service handler — the mirror of `wc_stats` on the outbound side, and the
 * usage question the request log cannot answer once it has been pruned.
 *
 * Shapes worth noting, all of which have to match the Drizzle declaration or
 * the startup drift gate refuses to boot:
 *
 * - The uniqueness tuple is a named UNIQUE CONSTRAINT, not a unique index. It
 *   is also the conflict target of the insert-or-increment, so concurrent
 *   calls cannot lose counts.
 * - The client reference is left to name itself (`ws_stats_client_id_fkey`),
 *   which is what both Postgres and drizzle-kit's push produce, so a database
 *   created by this migration and one created by a push carry the same object.
 * - `ymd` is a real `date`. Every day column in this app is one, and the
 *   outbound counter had to be converted into one after the fact.
 *
 * Idempotent: the table is created only if it is absent.
 */
async function up(): Promise<void> {
  if (await tableExists("ws_stats")) {
    logger.info("ws_stats table already exists, skipping", { service: SERVICE });
    return;
  }

  await db.execute(sql`
    CREATE TABLE ws_stats (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      plugin_id varchar(64) NOT NULL,
      client_id varchar NOT NULL REFERENCES ws_clients(id) ON DELETE CASCADE,
      operation varchar(64) NOT NULL,
      ymd date NOT NULL,
      calls integer NOT NULL DEFAULT 0,
      CONSTRAINT ws_stats_plugin_client_operation_ymd_uniq
        UNIQUE (plugin_id, client_id, operation, ymd)
    )
  `);
  logger.info("Created ws_stats table", { service: SERVICE });
}

const migration: Migration = {
  version: 1141,
  name: "create_ws_stats",
  description:
    "Create ws_stats, the per-day counter of incoming web service calls (one row per plugin + client + operation + day, unique on that tuple as a named constraint so the insert-or-increment has a conflict target). Counts only calls that reached a service handler; every refusal counts nothing. The client is a cascading reference, so deleting a client takes its usage counts with it.",
  up,
};

registerMigration(migration);

export default migration;
