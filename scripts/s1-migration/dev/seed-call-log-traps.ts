/**
 * DEV-ONLY rehearsal helper — seed FAKE staged sirius_log rows so the dev
 * rehearsal keeps exercising every N21 call-log reject class (and the
 * issue_reported channel mapping) after the worker-handler fallback.
 *
 * Why fakes: the synthetic DB's original handler_unresolved trap is a
 * sirius_worker-nid handler ref, which the loader now RESOLVES via the
 * id_map("worker") fallback (that was the point — the rehearsal's ~9.2K
 * handler_unresolved rejects were worker refs). Regenerating the synthetic
 * MariaDB would invalidate id_map (new nids), so coverage is restored by
 * inserting staged fakes directly into s1_staging.records instead:
 *
 *   - 99900901 → handler_unresolved: handler ref to 99900904, which IS staged
 *     (bundle sirius_log, out-of-scope type) but mapped by no loader.
 *   - 99900902 → handler_dangling: handler ref to 99900999, absent from
 *     staging entirely (the deleted-S1-node case).
 *   - 99900903 → loads on the NEW issue_reported channel (category
 *     "Issue Reported for Member", ruling 2026-08-11); handler is a real
 *     mapped contact nid picked from id_map at run time.
 *   - 99900904 → the staged-but-unmapped handler target (out of N21 scope by
 *     type, so it adds 1 to stagedLogs but not to inScope).
 *
 * Idempotent (upsert by (bundle, nid)); nids live in a 999xxxxx range far
 * above synthetic nids. NOTE: a full restage sweeps these rows (stale-delete
 * by watermark) — re-run this script after any restage, BEFORE step 13.
 *
 * PRODUCTION: NOT used.
 *
 * Usage: npx tsx scripts/s1-migration/dev/seed-call-log-traps.ts
 */
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema } from "../lib/staging";
import { ensureIdMap } from "../lib/idmap";

const CREATED_EPOCH = 1717200000; // 2024-06-01, deterministic

function scalar(value: string) {
  return { value, format: null };
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  // A real mapped contact nid (non-stub) for the issue_reported row's handler.
  const contactRes = await db.execute(sql`
    SELECT s1_id FROM s1_staging.id_map
     WHERE entity = 'contact' AND stub = false
     ORDER BY s1_id LIMIT 1
  `);
  const contactNid = Number(
    (contactRes as unknown as { rows: Array<{ s1_id: string | number }> }).rows[0]?.s1_id ?? NaN,
  );
  if (!Number.isFinite(contactNid)) {
    throw new Error(
      "ABORTING: no mapped contact in s1_staging.id_map — run load-contacts-workers first.",
    );
  }

  const rows: Array<{ nid: number; title: string; fields: Record<string, unknown> }> = [
    {
      nid: 99900901,
      title: "TRAP staged-but-unmapped handler",
      fields: {
        field_sirius_type: scalar("Other"),
        field_sirius_category: scalar("Call from Member"),
        field_sirius_log_handler: [99900904],
        field_sirius_summary: scalar("Synthetic trap: handler staged but unmapped"),
      },
    },
    {
      nid: 99900902,
      title: "TRAP dangling handler",
      fields: {
        field_sirius_type: scalar("Other"),
        field_sirius_category: scalar("Call from Member"),
        field_sirius_log_handler: [99900999],
        field_sirius_summary: scalar("Synthetic trap: handler absent from staging"),
      },
    },
    {
      nid: 99900903,
      title: "Issue reported channel row",
      fields: {
        field_sirius_type: scalar("Other"),
        field_sirius_category: scalar("Issue Reported for Member"),
        field_sirius_log_handler: [contactNid],
        field_sirius_summary: scalar("Synthetic: issue reported for member channel mapping"),
      },
    },
    {
      nid: 99900904,
      title: "TRAP handler target (staged, never mapped)",
      fields: {
        field_sirius_type: scalar("system"),
      },
    },
  ];

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, vid, title, uid, status, created, changed, fields)
      VALUES ('sirius_log', ${r.nid}, ${r.nid}, ${r.title}, 1, 1, ${CREATED_EPOCH}, ${CREATED_EPOCH}, ${JSON.stringify(r.fields)}::jsonb)
      ON CONFLICT (bundle, nid) DO UPDATE SET
        title = EXCLUDED.title, fields = EXCLUDED.fields, extracted_at = now()
    `);
  }
  console.log(
    `seeded ${rows.length} fake staged sirius_log rows (issue_reported handler = contact nid ${contactNid})`,
  );
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
