import { sql, type SQL } from "drizzle-orm";
import { getClient, runInTransaction } from "../../../../../storage/transaction-context";
import type { HistoricalEmployerUpload } from "../../../../../../shared/historical-employer-upload";

// Migration-only SQL belongs to the S1 Oneoff. No HTTP execution route.
const ENTITY = "s1_employer_wizard";
const LOADER = "s1-employer-wizards";
async function rows<T>(query: SQL): Promise<T[]> {
  return (await getClient().execute(query) as unknown as { rows: T[] }).rows;
}
export interface StagedUploadNode {
  nid: number;
  created: number | null;
  changed: number | null;
  fields: Record<string, unknown>;
}
function sourceRow(row: StagedUploadNode): StagedUploadNode {
  return { ...row, nid: Number(row.nid),
    created: row.created == null ? null : Number(row.created),
    changed: row.changed == null ? null : Number(row.changed) };
}

export const s1EmployerWizards = {
  async prerequisites() {
    const [state] = await rows<{ ready: boolean }>(sql`
      SELECT to_regclass('s1_staging.records') IS NOT NULL
         AND to_regclass('s1_staging.id_map') IS NOT NULL
         AND to_regclass('public.wizards') IS NOT NULL
         AND to_regclass('public.wizard_employer_monthly') IS NOT NULL AS ready`);
    if (!state?.ready) throw new Error("Employer upload history requires staging, employer mappings, and monthly wizard tables.");
    const counts = await rows<{ bundle: string; n: number }>(sql`
      SELECT bundle, count(*)::int AS n FROM s1_staging.records
      WHERE bundle IN ('sirius_feed', 'sirius_log', 'grievance_shop') GROUP BY bundle`);
    for (const bundle of ["sirius_feed", "sirius_log", "grievance_shop"]) {
      if (!counts.some(r => r.bundle === bundle && r.n > 0)) throw new Error(`Required staged bundle missing or empty: ${bundle}`);
    }
  },
  async context() {
    const parents = await rows<StagedUploadNode>(sql`
      SELECT nid, created, changed, jsonb_build_object(
        'field_sirius_category', fields->'field_sirius_category',
        'field_sirius_notes', fields->'field_sirius_notes',
        'field_sirius_log_handler', fields->'field_sirius_log_handler') AS fields
      FROM s1_staging.records WHERE bundle = 'sirius_log'
        AND jsonb_path_exists(fields, '$.field_sirius_category.** ? (@ == "smf:ehrs")')
      ORDER BY nid`);
    const employers = await rows<{ nid: number }>(sql`
      SELECT nid FROM s1_staging.records WHERE bundle = 'grievance_shop'`);
    const mappings = await rows<{ s1_id: number }>(sql`
      SELECT s1_id FROM s1_staging.id_map WHERE entity = ${ENTITY}`);
    return { parents: parents.map(sourceRow), employers: new Set(employers.map(r => Number(r.nid))),
      mappedFeeds: new Set(mappings.map(r => Number(r.s1_id))) };
  },
  async page(after: number) {
    const page = await rows<StagedUploadNode>(sql`
      SELECT nid, created, changed, jsonb_build_object(
        'field_sirius_type', fields->'field_sirius_type',
        'field_sirius_feed_status', fields->'field_sirius_feed_status',
        'field_grievance_shop', fields->'field_grievance_shop',
        'field_sirius_json', fields->'field_sirius_json') AS fields
      FROM s1_staging.records WHERE bundle = 'sirius_feed' AND nid > ${after}
      ORDER BY nid LIMIT 100`);
    return page.map(sourceRow);
  },
  async reconcile(history: HistoricalEmployerUpload, fingerprint: string, logicVersion: number, dryRun: boolean) {
    return runInTransaction(async () => {
      const client = getClient();
      await client.execute(sql`SET LOCAL lock_timeout = '10s'`);
      await client.execute(sql`SET LOCAL statement_timeout = '60s'`);
      await client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"s1-employer-wizard:" + history.feedNid}, 0))`);
      const employers = await rows<{ id: string }>(sql`
        SELECT e.id FROM s1_staging.id_map m JOIN employers e ON e.id = m.s2_id
        WHERE m.entity = 'employer' AND m.s1_id = ${history.employerNid} AND NOT m.stub
          AND m.s1_deleted_at IS NULL FOR KEY SHARE OF e`);
      if (employers.length !== 1) throw new Error("destination_employer_missing");
      const employerId = employers[0].id;
      const id = `s1-employer-upload-${history.feedNid}`;
      const status = history.sourceStatus === "complete" ? "completed" : "draft";
      const data = JSON.stringify({ historicalEmployerUpload: history });
      const mappings = await rows<{ s2_id: string; loader: string; stub: boolean }>(sql`
        SELECT s2_id, loader, stub FROM s1_staging.id_map
        WHERE entity = ${ENTITY} AND s1_id = ${history.feedNid} FOR UPDATE`);
      if (mappings.some(m => m.s2_id !== id || m.loader !== LOADER || m.stub)) throw new Error("source_identity_conflict");
      const targets = await rows<{ id: string; owned: boolean; matches: boolean }>(sql`
        SELECT w.id,
          (w.type = 'bao_monthly_hours'
           AND w.data->'historicalEmployerUpload'->>'kind' = 's1-employer-upload'
           AND w.data->'historicalEmployerUpload'->>'feedNid' = ${String(history.feedNid)}) AS owned,
          (w.type = 'bao_monthly_hours' AND w.entity_id = ${employerId}
           AND w.status = ${status} AND w.current_step IS NULL
           AND w.date = to_timestamp(${history.createdEpoch}) AT TIME ZONE current_setting('TimeZone')
           AND w.data = ${data}::jsonb AND wm.employer_id = ${employerId}
           AND wm.year = ${history.year} AND wm.month = ${history.month}) AS matches
        FROM wizards w LEFT JOIN wizard_employer_monthly wm ON wm.wizard_id = w.id
        WHERE w.id = ${id} OR (w.data->'historicalEmployerUpload'->>'kind' = 's1-employer-upload'
          AND w.data->'historicalEmployerUpload'->>'feedNid' = ${String(history.feedNid)})
        FOR UPDATE OF w`);
      if (targets.length > 1 || targets.some(t => t.id !== id || !t.owned)) throw new Error("destination_identity_conflict");
      const outcome = !targets.length ? "created" : targets[0].matches && mappings.length === 1 ? "unchanged" : "updated";
      if (!dryRun) {
        if (!targets.length) {
          await client.execute(sql`
            INSERT INTO wizards (id, date, type, status, current_step, entity_id, data)
            VALUES (${id}, to_timestamp(${history.createdEpoch}) AT TIME ZONE current_setting('TimeZone'),
              'bao_monthly_hours', ${status}, NULL, ${employerId}, ${data}::jsonb)`);
        } else if (!targets[0].matches) {
          await client.execute(sql`
            UPDATE wizards SET date = to_timestamp(${history.createdEpoch}) AT TIME ZONE current_setting('TimeZone'),
              status = ${status}, current_step = NULL, entity_id = ${employerId}, data = ${data}::jsonb
            WHERE id = ${id}`);
        }
        await client.execute(sql`
          INSERT INTO wizard_employer_monthly (wizard_id, employer_id, year, month)
          VALUES (${id}, ${employerId}, ${history.year}, ${history.month})
          ON CONFLICT (wizard_id) DO UPDATE SET employer_id = EXCLUDED.employer_id,
            year = EXCLUDED.year, month = EXCLUDED.month`);
        await client.execute(sql`
          INSERT INTO s1_staging.id_map
            (entity, s1_id, s2_id, stub, loader, consumed_fingerprint, logic_version, last_synced_at)
          VALUES (${ENTITY}, ${history.feedNid}, ${id}, false, ${LOADER}, ${fingerprint}, ${logicVersion}, now())
          ON CONFLICT (entity, s1_id) DO UPDATE SET consumed_fingerprint = EXCLUDED.consumed_fingerprint,
            logic_version = EXCLUDED.logic_version, last_synced_at = now(), s1_deleted_at = NULL`);
        const [proof] = await rows<{ valid: boolean }>(sql`
          SELECT w.status = ${status} AND w.entity_id = ${employerId} AND w.current_step IS NULL
            AND w.type = 'bao_monthly_hours' AND w.data = ${data}::jsonb
            AND w.date = to_timestamp(${history.createdEpoch}) AT TIME ZONE current_setting('TimeZone')
            AND wm.employer_id = ${employerId} AND wm.year = ${history.year} AND wm.month = ${history.month}
            AND m.s2_id = w.id AND m.loader = ${LOADER} AND NOT m.stub
            AND m.consumed_fingerprint = ${fingerprint} AND m.logic_version = ${logicVersion} AS valid
          FROM wizards w JOIN wizard_employer_monthly wm ON wm.wizard_id = w.id
          JOIN s1_staging.id_map m ON m.entity = ${ENTITY} AND m.s1_id = ${history.feedNid}
          WHERE w.id = ${id}`);
        if (!proof?.valid) throw new Error("destination_verification_failed");
      }
      return outcome;
    });
  },
  async missingSourceCount() {
    const [r] = await rows<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM s1_staging.id_map m
      WHERE m.entity = ${ENTITY} AND m.loader = ${LOADER} AND NOT EXISTS (
        SELECT 1 FROM s1_staging.records r WHERE r.bundle = 'sirius_feed' AND r.nid = m.s1_id)`);
    return r.n;
  },
};
