import { sql } from "drizzle-orm";
import { db } from "./db";

export interface ImportedCoverageEvidence {
  report: unknown;
  identityVerified: boolean;
  snapshotVerified: boolean;
  firstMonthIndex: number | null;
  /** Positive source spans are never interpreted as negative decisions if WMBs are missing. */
  desiredMonthIndexes: number[];
}

/**
 * Read only, no staging creation or loader imports. A single snapshot, bounded
 * by a database timeout. Missing/old staging is an unavailable answer upstream.
 * Never search backwards for an old success past a newer failed import.
 */
export async function readWorkerImportedCoverageEvidence(
  workerId: string,
  months: Array<{ year: number; month: number }>,
): Promise<ImportedCoverageEvidence | null> {
  if (!months.length) return null;
  if (months.length > 120 || months.some(({ year, month }) =>
    !Number.isSafeInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12)) {
    throw new Error("Invalid imported history page");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    await tx.execute(sql`SET LOCAL statement_timeout = '1500ms'`);
    const result = await tx.execute(sql`
      WITH latest AS (
        SELECT report, started_at, finished_at
        FROM s1_staging.runs
        WHERE args->>'loader' = 't17-benefit-history'
        ORDER BY id DESC LIMIT 1
      ), identity AS (
        SELECT m.s1_id
        FROM s1_staging.id_map m
        JOIN s1_staging.records r ON r.bundle = 'sirius_worker' AND r.nid = m.s1_id
        JOIN workers w ON w.id = m.s2_id
        WHERE m.entity = 'worker' AND m.s2_id = ${workerId}
          AND m.stub = false AND m.s1_deleted_at IS NULL
          AND m.loader = 't3t1-contacts-workers'
          AND m.consumed_fingerprint IS NOT NULL
          AND m.consumed_fingerprint = r.content_hash
      )
      SELECT latest.report,
        (SELECT count(*) = 1 FROM identity) AS "identityVerified",
        (
          NOT EXISTS (
            SELECT 1 FROM s1_staging.records r
            WHERE r.bundle = 'sirius_trust_worker_benefit'
              AND r.extracted_at > latest.started_at
          )
          AND (SELECT count(*) FROM s1_staging.records
               WHERE bundle = 'sirius_trust_worker_benefit')::text =
              latest.report->'detail'->>'staged'
          AND NOT EXISTS (
            SELECT 1 FROM s1_staging.t17_desired_spans s
            LEFT JOIN s1_staging.records r
              ON r.bundle = 'sirius_trust_worker_benefit' AND r.nid = s.nid
            WHERE s.worker_id = ${workerId} AND (
              r.nid IS NULL OR s.consumed_fingerprint IS NULL
              OR s.consumed_fingerprint IS DISTINCT FROM r.content_hash
              OR s.last_synced_at > latest.finished_at
              OR s.logic_version IS DISTINCT FROM
                 (latest.report->>'logicVersion')::int
            )
          )
        ) AS "snapshotVerified",
        (SELECT min(start_idx) FROM s1_staging.t17_desired_spans
         WHERE worker_id = ${workerId}) AS "firstMonthIndex",
        ARRAY(
          SELECT requested.idx
          FROM (VALUES ${sql.join(months.map(({ year, month }) => sql`(${year * 12 + month - 1}::int)`), sql`, `)}) requested(idx)
          WHERE EXISTS (
            SELECT 1 FROM s1_staging.t17_desired_spans s
            WHERE s.worker_id = ${workerId} AND s.start_idx <= requested.idx
              AND (s.end_idx IS NULL OR s.end_idx >= requested.idx)
          )
        ) AS "desiredMonthIndexes"
      FROM latest
    `);
    return (result as unknown as { rows: ImportedCoverageEvidence[] }).rows[0] ?? null;
  }, { isolationLevel: "repeatable read" });
}
