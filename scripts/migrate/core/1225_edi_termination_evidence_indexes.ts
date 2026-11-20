import type { Pool } from "pg";
import { pool } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const indexes = [
  {
    name: "trust_wmb_worker_benefit_month_idx",
    table: "trust_wmb",
    columns: ["worker_id", "benefit_id", "year", "month"],
  },
  {
    name: "trust_wmb_events_edi_termination_lookup_idx",
    table: "trust_wmb_events",
    columns: ["benefit_id", "event_type", "year", "month", "id"],
  },
] as const;

const normalize = (value: string | null) => value?.replace(/[()\s"]/g, "").toLowerCase() ?? null;

/** These tables belong to the optional trust.benefits component. */
export async function installEdiTerminationEvidenceIndexes(connectionPool: Pick<Pool, "connect">): Promise<void> {
  const client = await connectionPool.connect();
  let discard = false;
  let settings: { lock_timeout: string; statement_timeout: string } | undefined;
  try {
    const previous = await client.query(
      "SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout",
    );
    settings = previous.rows[0];
    await client.query("SELECT set_config('lock_timeout', '30s', false), set_config('statement_timeout', '90s', false)");

    for (const spec of indexes) {
      const table = await client.query("SELECT to_regclass($1) AS oid", [`public.${spec.table}`]);
      if (!table.rows[0]?.oid) continue;
      const found = await client.query(`
        SELECT i.indisvalid, i.indisunique, i.indisprimary, am.amname,
          i.indrelid = $1::regclass AS correct_table,
          i.indnatts, i.indnkeyatts, i.indoption::text AS options,
          ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true)
                FROM generate_series(1, i.indnkeyatts) n) AS columns,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_am am ON am.oid = c.relam
        WHERE ns.nspname = 'public' AND c.relname = $2`, [`public.${spec.table}`, spec.name]);
      const existing = found.rows[0];
      if (existing) {
        const matches = existing.correct_table && !existing.indisunique && !existing.indisprimary
          && existing.amname === "btree"
          && existing.indnatts === spec.columns.length && existing.indnkeyatts === spec.columns.length
          && existing.options === spec.columns.map(() => "0").join(" ")
          && JSON.stringify(existing.columns) === JSON.stringify(spec.columns)
          && normalize(existing.predicate) === null;
        if (!matches) throw new Error(`EDI termination index definition drift: ${spec.name}; inspect before retrying migration 1225.`);
        if (existing.indisvalid) continue;
        await client.query(`DROP INDEX CONCURRENTLY public."${spec.name}"`);
      }
      await client.query(
        `CREATE INDEX CONCURRENTLY "${spec.name}" ON public."${spec.table}" (${spec.columns.join(", ")})`,
      );
    }
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
}

const migration: Migration = {
  version: 1225,
  name: "edi_termination_evidence_indexes",
  description: "Index bounded EDI termination-event and later-coverage checks.",
  up: () => installEdiTerminationEvidenceIndexes(pool),
};

registerMigration(migration);
export default migration;
