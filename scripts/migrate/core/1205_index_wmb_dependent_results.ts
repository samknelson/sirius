import { pool } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const name = "trust_wmb_scan_queue_dependent_result_idx";

// Non-transactional: avoid blocking writes on a potentially large queue.
// A failed concurrent build leaves an invalid index, which the next run can
// safely remove and retry without dropping any valid operator-owned index.
const migration: Migration = {
  version: 1205,
  name: "index_wmb_dependent_results",
  description: "Index dependent scan summaries for termination-event reconciliation.",
  async up() {
    const client = await pool.connect();
    let settings: { lock_timeout: string; statement_timeout: string } | undefined;
    let discard = false;
    try {
      const previous = await client.query("SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout");
      settings = previous.rows[0];
      await client.query("SELECT set_config('lock_timeout', '30s', false), set_config('statement_timeout', '90s', false)");
      const table = await client.query("SELECT to_regclass('public.trust_wmb_scan_queue') AS oid");
      if (!table.rows[0]?.oid) return;
      const index = await client.query(`
        SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_index i ON i.indexrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = $1`, [name]);
      const expected = `CREATE INDEX ${name} ON public.trust_wmb_scan_queue USING gin (((result_summary -> 'people'::text)))`;
      if (index.rows.length) {
        if (index.rows[0].definition !== expected) {
          throw new Error(`WMB dependent result index definition drift: ${name}`);
        }
        if (index.rows[0].indisvalid) return;
        await client.query(`DROP INDEX CONCURRENTLY public.${name}`);
      }
      await client.query(`CREATE INDEX CONCURRENTLY ${name}
        ON public.trust_wmb_scan_queue USING gin ((result_summary -> 'people'))`);
    } finally {
      try {
        if (settings) await client.query(
          "SELECT set_config('lock_timeout', $1, false), set_config('statement_timeout', $2, false)",
          [settings.lock_timeout, settings.statement_timeout],
        );
      } catch {
        discard = true;
      }
      client.release(discard);
    }
  },
};
registerMigration(migration);
export default migration;
