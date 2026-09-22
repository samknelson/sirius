import type { Pool } from "pg";
import { pool } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

export const queueReadIndexes = [
  { name: "trust_wmb_scan_queue_worker_idx", columns: ["worker_id"], predicate: null },
  { name: "trust_wmb_scan_queue_pending_claim_idx", columns: ["scheduled_for", "id"], predicate: "(status)::text = 'pending'::text" },
  { name: "trust_wmb_scan_queue_active_run_idx", columns: ["status_id"], predicate: "(status)::text = ANY (ARRAY['pending'::text, 'processing'::text])" },
] as const;

const normalize = (value: string | null) => value?.replace(/[()\s"]/g, "").toLowerCase() ?? null;

/** No transaction: concurrent builds must not block queue writers. A failed
 * build is intentionally retried by the next migration run, not an unbounded
 * boot-time retry loop. Only invalid artifacts owned by this migration drop. */
export async function installQueueReadIndexes(connectionPool: Pick<Pool, "connect">): Promise<void> {
  const client = await connectionPool.connect();
  let discard = false;
  let settings: { lock_timeout: string; statement_timeout: string } | undefined;
  try {
    const previous = await client.query("SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout");
    settings = previous.rows[0];
    await client.query("SELECT set_config('lock_timeout', '5s', false), set_config('statement_timeout', '60s', false)");
    const table = await client.query("SELECT to_regclass('public.trust_wmb_scan_queue') AS oid");
    if (!table.rows[0]?.oid) return; // optional component disabled

    for (const spec of queueReadIndexes) {
      const found = await client.query(`
        SELECT i.indisvalid, i.indisunique, i.indisprimary, am.amname,
          i.indrelid = 'public.trust_wmb_scan_queue'::regclass AS correct_table,
          i.indnatts, i.indnkeyatts, i.indoption::text AS options,
          ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true)
                FROM generate_series(1, i.indnkeyatts) n) AS columns,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_am am ON am.oid = c.relam
        WHERE ns.nspname = 'public' AND c.relname = $1`, [spec.name]);
      const existing = found.rows[0];
      if (existing) {
        const matches = existing.correct_table && !existing.indisunique && !existing.indisprimary
          && existing.amname === "btree"
          && existing.indnatts === spec.columns.length && existing.indnkeyatts === spec.columns.length
          && existing.options === spec.columns.map(() => "0").join(" ")
          && JSON.stringify(existing.columns) === JSON.stringify(spec.columns)
          && normalize(existing.predicate) === normalize(spec.predicate);
        // Never remove a different index even if it happens to share our name.
        if (!matches) throw new Error(`Queue index definition drift: ${spec.name}; inspect and repair before retrying migration 1198.`);
        if (existing.indisvalid) continue;
        await client.query(`DROP INDEX CONCURRENTLY public."${spec.name}"`);
      }
      await client.query(`CREATE INDEX CONCURRENTLY "${spec.name}" ON public.trust_wmb_scan_queue (${spec.columns.join(", ")})${spec.predicate ? ` WHERE ${spec.predicate}` : ""}`);
    }
  } finally {
    try {
      if (settings) await client.query("SELECT set_config('lock_timeout', $1, false), set_config('statement_timeout', $2, false)", [settings.lock_timeout, settings.statement_timeout]);
    } catch {
      discard = true; // Never return a session with unknown settings to the pool.
    }
    client.release(discard);
  }
}

const migration: Migration = {
  version: 1198,
  name: "index_wmb_worker_queue",
  description: "Keep worker queue reads, pending claims and run completion probes bounded as scan history grows.",
  up: () => installQueueReadIndexes(pool),
};
registerMigration(migration);
export default migration;