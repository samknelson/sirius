/**
 * READ-ONLY triage for T17 `wmb_create_failed` rejects.
 *
 * A failed T17 run leaves its attempted rows in the run-scoped
 * s1_staging.t17_missing_rows table. This script classifies those rows without
 * retrying writes or changing S1/S2:
 *   - missing worker / employer / benefit foreign key
 *   - missing source relationship foreign key, including whether the current
 *     relation id_map has moved to a different live S2 relation
 *   - an exact WMB row that appeared after the diff was materialized
 *   - unknown insert failure (use the loader's sanitized `code` on the rerun)
 *
 * Output is aggregates plus S1 nids/months and mapping-state booleans only.
 * It intentionally prints no names, raw staged fields, or database errors.
 *
 * Run on the SAME rehearsal target immediately after the failed T17 run:
 *   npx tsx scripts/oneoffs/s1-t17-wmb-create-failure-triage.ts
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../../server/storage/db";
import { getMappings } from "../s1-migration/lib/idmap";
import { targetNidOf } from "../s1-migration/lib/loader-utils";

type MissingRow = {
  nid: string | number;
  month: number;
  year: number;
  source_relation_id: string | null;
  worker_exists: boolean;
  employer_exists: boolean;
  benefit_exists: boolean;
  source_relation_exists: boolean;
  exact_wmb_exists: boolean;
};

type Cause =
  | "missing_worker"
  | "missing_employer"
  | "missing_benefit"
  | "missing_source_relation_mapping_changed"
  | "missing_source_relation_mapping_absent"
  | "missing_source_relation_mapping_points_to_missing_row"
  | "exact_wmb_now_exists"
  | "unknown_insert_failure";

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

async function main(): Promise<void> {
  const [tableProbe] = rowsOf<{ table_name: string | null }>(
    await db.execute(sql`SELECT to_regclass('s1_staging.t17_missing_rows')::text AS table_name`),
  );
  if (!tableProbe?.table_name) {
    throw new Error("s1_staging.t17_missing_rows does not exist; run T17 once on this target first");
  }

  const missing = rowsOf<MissingRow>(
    await db.execute(sql`
      SELECT
        m.nid,
        m.month,
        m.year,
        m.source_relation_id,
        (w.id IS NOT NULL) AS worker_exists,
        (e.id IS NOT NULL) AS employer_exists,
        (b.id IS NOT NULL) AS benefit_exists,
        (m.source_relation_id IS NULL OR r.id IS NOT NULL) AS source_relation_exists,
        (live.id IS NOT NULL) AS exact_wmb_exists
      FROM s1_staging.t17_missing_rows m
      LEFT JOIN workers w ON w.id = m.worker_id
      LEFT JOIN employers e ON e.id = m.employer_id
      LEFT JOIN trust_benefits b ON b.id = m.benefit_id
      LEFT JOIN worker_relations r ON r.id = m.source_relation_id
      LEFT JOIN trust_wmb live
        ON live.worker_id = m.worker_id
       AND live.employer_id = m.employer_id
       AND live.benefit_id = m.benefit_id
       AND live.month = m.month
       AND live.year = m.year
      ORDER BY m.nid, m.year, m.month
    `),
  );

  const nids = [...new Set(missing.map((row) => Number(row.nid)))];
  const staged = rowsOf<{ nid: string | number; fields: unknown }>(
    nids.length === 0
      ? { rows: [] }
      : await db.execute(sql`
          SELECT nid, fields
          FROM s1_staging.records
          WHERE bundle = 'sirius_trust_worker_benefit'
            AND nid IN (${sql.join(nids.map((nid) => sql`${nid}`), sql`, `)})
        `),
  );
  const relationNidBySpan = new Map<number, number>();
  for (const row of staged) {
    const fields = (typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields ?? {}) as Record<string, unknown>;
    const relationNid = targetNidOf(fields, "field_sirius_contact_relation");
    if (relationNid != null) relationNidBySpan.set(Number(row.nid), relationNid);
  }
  const relationMap = await getMappings("relation", [...new Set(relationNidBySpan.values())]);

  const counts: Record<Cause, number> = {
    missing_worker: 0,
    missing_employer: 0,
    missing_benefit: 0,
    missing_source_relation_mapping_changed: 0,
    missing_source_relation_mapping_absent: 0,
    missing_source_relation_mapping_points_to_missing_row: 0,
    exact_wmb_now_exists: 0,
    unknown_insert_failure: 0,
  };
  const distinctNids = new Map<Cause, Set<number>>();
  const samples = new Map<Cause, Array<Record<string, unknown>>>();

  for (const row of missing) {
    const nid = Number(row.nid);
    const relationNid = relationNidBySpan.get(nid);
    const currentRelationId = relationNid == null ? null : relationMap.get(relationNid)?.s2Id ?? null;
    let cause: Cause;
    if (!row.worker_exists) cause = "missing_worker";
    else if (!row.employer_exists) cause = "missing_employer";
    else if (!row.benefit_exists) cause = "missing_benefit";
    else if (!row.source_relation_exists) {
      if (!currentRelationId) cause = "missing_source_relation_mapping_absent";
      else if (currentRelationId !== row.source_relation_id) cause = "missing_source_relation_mapping_changed";
      else cause = "missing_source_relation_mapping_points_to_missing_row";
    } else if (row.exact_wmb_exists) cause = "exact_wmb_now_exists";
    else cause = "unknown_insert_failure";

    counts[cause]++;
    const ids = distinctNids.get(cause) ?? new Set<number>();
    ids.add(nid);
    distinctNids.set(cause, ids);
    const list = samples.get(cause) ?? [];
    if (list.length < 25) {
      list.push({
        nid,
        ym: `${row.year}-${String(row.month).padStart(2, "0")}`,
        relationNid: relationNid ?? null,
        hasSourceRelation: row.source_relation_id != null,
        currentMappingMatchesDesired:
          row.source_relation_id == null || currentRelationId == null
            ? null
            : currentRelationId === row.source_relation_id,
      });
    }
    samples.set(cause, list);
  }

  const activeCauses = Object.fromEntries(
    (Object.keys(counts) as Cause[])
      .filter((cause) => counts[cause] > 0)
      .map((cause) => [
        cause,
        {
          rows: counts[cause],
          distinctSpanNids: distinctNids.get(cause)?.size ?? 0,
          samples: samples.get(cause) ?? [],
        },
      ]),
  );

  console.log(JSON.stringify({
    diagnostic: "t17-wmb-create-failure-triage",
    readOnly: true,
    attemptedRows: missing.length,
    distinctSpanNids: nids.length,
    causes: activeCauses,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown triage failure");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });