/**
 * DEV-ONLY rehearsal helper — seed FAKE staged cardcheck rows so the dev
 * rehearsal exercises every load-cardchecks.ts path. Synthetic dev staging
 * has ZERO cardcheck rows (same gap as tags/beneficiaries), so coverage
 * comes from staged fakes inserted directly into s1_staging.records.
 *
 * Seeded coverage (per the task's trap list):
 *   Definitions (bundle sirius_json_definition, type sirius:cardcheck):
 *     99910001 — "TEST Payroll Deduction Form A": disclaimer 99910003
 *                (resolves, text present) + customfield 99910004 (resolves).
 *     99910002 — "TEST Arbitration Agreement B": disclaimer 99910005 which
 *                is NOT staged → disclaimer_missing reject; no customfield.
 *   Pointer nodes:
 *     99910003 — disclaimer node with text (extractable).
 *     99910004 — customfield schema node.
 *   Records (bundle sirius_log, category cardcheck):
 *     99910101 — signed, handler order SWAPPED (worker first), full payload
 *                (acceptance + matching disclaimer dup + esig + customfield
 *                + cardcheck.title + empty bu) → loads signed. Category is a
 *                {value,format} object; type is a bare scalar.
 *     99910102 — unsigned, definition-only handler (no worker) →
 *                noWorkerHandler counted skip. Category is a BARE SCALAR.
 *     99910103 — signed, handler [def, 99919999] where 99919999 is absent
 *                from staging → handler_dangling reject.
 *     99910104 — signed, unparseable field_sirius_json → bad_json reject.
 *     99910105 — wiped-unsigned: status unsigned, JSON present but empty
 *                object (clear() aftermath) → loads pending. Category is an
 *                ARRAY of {value} (extra-delta anomaly shape); type is a
 *                {value,format} object.
 *     99910106 — revoked, revocation metadata + esig → loads revoked.
 *     99910107 — signed, acceptance.ts DISAGREES with
 *                disclaimer[...].acceptances[0].ts → loads +
 *                dualAcceptanceMismatch.
 *     99910108 — signed on definition B, acceptance present, NO esig →
 *                loads + signedWithoutEsig.
 *     99910109 — signed, unexpected offline keys under acceptance → loads +
 *                offlineKeysPresent.
 *     99910110 — signed, handler worker target 99910200 staged as
 *                sirius_worker but in NO id_map → handler_unresolved reject.
 *     99910200 — the staged-but-unmapped sirius_worker handler target.
 *
 * Worker/definition pairs are chosen so no two loadable SIGNED records share
 * a (worker, definition) pair — the storage DUPLICATE_SIGNED validator would
 * reject the second one.
 *
 * Expected dev loader flags after seeding:
 *   --allow-rejects disclaimer_missing,handler_dangling,bad_json,handler_unresolved
 * Expected shape: definitions staged 2 / created 2; records inScope 10,
 * created 6, noWorkerHandler 1; rejects 1 each of handler_dangling,
 * bad_json, handler_unresolved (+ disclaimer_missing on the definitions
 * side); defects dualAcceptanceMismatch=1, signedWithoutEsig=1 (99910108;
 * 99910106 revoked carries an esig), offlineKeysPresent=1.
 *
 * Idempotent (upsert by (bundle, nid)); nids live in the 999xxxxx range far
 * above synthetic nids. NOTE: a full restage sweeps these rows (stale-delete
 * by watermark) — re-run this script after any restage, BEFORE the
 * cardchecks loader step.
 *
 * PRODUCTION: NOT used.
 *
 * Usage: npx tsx scripts/s1-migration/dev/seed-cardcheck-fakes.ts
 */
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema } from "../lib/staging";
import { ensureIdMap } from "../lib/idmap";

const CREATED_EPOCH = 1717200000; // 2024-06-01, deterministic
const ACCEPT_TS = 1717300000;
const REVOKE_TS = 1717400000;

const DEF_A = 99910001;
const DEF_B = 99910002;
const DISCLAIMER_A = 99910003;
const CUSTOMFIELD_A = 99910004;
const DISCLAIMER_B_MISSING = 99910005; // never staged
const UNMAPPED_WORKER = 99910200;
const DANGLING_NID = 99919999; // never staged

function scalar(value: string) {
  return { value, format: null };
}

function jsonField(obj: unknown) {
  return { value: JSON.stringify(obj), format: null };
}

function acceptance(ts: number, extra?: Record<string, unknown>) {
  return { ts, uid: 42, user_name: "TEST STAFF", ...extra };
}

function fullPayload(opts: {
  acceptTs?: number;
  disclaimerTs?: number;
  esig?: boolean;
  revocation?: boolean;
  offline?: boolean;
  customfield?: boolean;
}) {
  const payload: Record<string, unknown> = {};
  const cc: Record<string, unknown> = { bu: "", title: "TEST Job Title" };
  if (opts.acceptTs != null) {
    cc.acceptance = acceptance(opts.acceptTs, opts.offline ? { offline: { complete: 1, filename: "test.pdf", date: "2024-06-01" } } : undefined);
  }
  if (opts.revocation) cc.revocation = { ts: REVOKE_TS, uid: 43, user_name: "TEST STAFF 2" };
  payload.cardcheck = cc;
  if (opts.disclaimerTs != null) {
    payload.disclaimer = { [String(DISCLAIMER_A)]: { acceptances: [{ ts: opts.disclaimerTs, uid: 42 }] } };
  }
  if (opts.esig) payload.esig = { type: "online", points: [[1, 2], [3, 4]] };
  if (opts.customfield) payload.customfield = { [String(CUSTOMFIELD_A)]: { agree: "yes" } };
  return payload;
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  // Two real worker nids that are BOTH mapped (non-stub) AND still staged as
  // sirius_worker — the loader resolves the worker side of the handler by
  // staged bundle first, so an id_map entry alone (stale after a staging
  // regen) is not enough.
  const workerRes = await db.execute(sql`
    SELECT m.s1_id FROM s1_staging.id_map m
      JOIN s1_staging.records r ON r.bundle = 'sirius_worker' AND r.nid = m.s1_id
     WHERE m.entity = 'worker' AND m.stub = false
     ORDER BY m.s1_id LIMIT 2
  `);
  const workerNids = (workerRes as unknown as { rows: Array<{ s1_id: string | number }> }).rows.map((r) =>
    Number(r.s1_id),
  );
  if (workerNids.length < 2) {
    throw new Error(
      "ABORTING: need >=2 workers that are mapped in s1_staging.id_map AND staged as sirius_worker — " +
        "run stage.ts + load-contacts-workers first (a staging regen invalidates old id_map entries).",
    );
  }
  const [W1, W2] = workerNids;

  interface Fake {
    bundle: string;
    nid: number;
    title: string;
    fields: Record<string, unknown>;
  }

  const rows: Fake[] = [
    // ---- definitions + pointer nodes ------------------------------------
    {
      bundle: "sirius_json_definition",
      nid: DEF_A,
      title: "TEST Payroll Deduction Form A",
      fields: {
        field_sirius_type: scalar("sirius:cardcheck"),
        field_sirius_json: jsonField({
          cardcheck_definition: { disclaimer_nid: DISCLAIMER_A, customfield_nid: CUSTOMFIELD_A },
        }),
      },
    },
    {
      bundle: "sirius_json_definition",
      nid: DEF_B,
      title: "TEST Arbitration Agreement B",
      fields: {
        field_sirius_type: scalar("sirius:cardcheck"),
        field_sirius_json: jsonField({
          cardcheck_definition: { disclaimer_nid: DISCLAIMER_B_MISSING },
        }),
      },
    },
    {
      bundle: "sirius_json_definition",
      nid: DISCLAIMER_A,
      title: "TEST Disclaimer A",
      fields: {
        field_sirius_type: scalar("sirius:disclaimer"),
        field_sirius_json: jsonField({ disclaimer: { text: "TEST: I authorize the payroll deduction." } }),
      },
    },
    {
      bundle: "sirius_json_definition",
      nid: CUSTOMFIELD_A,
      title: "TEST Customfield A",
      fields: {
        field_sirius_type: scalar("customfield"),
        field_sirius_json: jsonField({ customfield: { fields: [{ name: "agree", type: "checkbox" }] } }),
      },
    },
    // ---- staged-but-unmapped worker target -------------------------------
    {
      bundle: "sirius_worker",
      nid: UNMAPPED_WORKER,
      title: "TEST unmapped worker",
      fields: { field_sirius_id: scalar("999999") },
    },
    // ---- records ----------------------------------------------------------
    {
      bundle: "sirius_log",
      nid: 99910101,
      title: "TEST signed, worker-first handler order",
      fields: {
        field_sirius_category: scalar("cardcheck"), // {value,format} shape
        field_sirius_type: "signed", // bare scalar shape
        field_sirius_log_handler: [W1, DEF_A], // SWAPPED: worker first
        field_sirius_json: jsonField(
          fullPayload({ acceptTs: ACCEPT_TS, disclaimerTs: ACCEPT_TS, esig: true, customfield: true }),
        ),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910102,
      title: "[No Handler]: TEST no-worker record",
      fields: {
        field_sirius_category: "cardcheck", // bare scalar shape
        field_sirius_type: scalar("unsigned"),
        field_sirius_log_handler: [DEF_A],
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910103,
      title: "TEST dangling worker handler",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("signed"),
        field_sirius_log_handler: [DEF_A, DANGLING_NID],
        field_sirius_json: jsonField(fullPayload({ acceptTs: ACCEPT_TS, esig: true })),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910104,
      title: "TEST unparseable json",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("signed"),
        field_sirius_log_handler: [DEF_A, W2],
        field_sirius_json: scalar("{this is not json"),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910105,
      title: "TEST wiped-unsigned record",
      fields: {
        field_sirius_category: [{ value: "cardcheck", format: null }], // array shape
        field_sirius_type: scalar("unsigned"), // {value,format} shape
        field_sirius_log_handler: [DEF_A, W2],
        field_sirius_json: jsonField({}), // clear() aftermath: empty payload
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910106,
      title: "TEST revoked record",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("revoked"),
        field_sirius_log_handler: [DEF_B, W1],
        field_sirius_json: jsonField(
          fullPayload({ acceptTs: ACCEPT_TS, disclaimerTs: ACCEPT_TS, esig: true, revocation: true }),
        ),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910107,
      title: "TEST dual-acceptance mismatch",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("signed"),
        field_sirius_log_handler: [DEF_A, W2],
        field_sirius_json: jsonField(
          fullPayload({ acceptTs: ACCEPT_TS, disclaimerTs: ACCEPT_TS + 3600, esig: true }),
        ),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910108,
      title: "TEST signed without esig",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("signed"),
        field_sirius_log_handler: [DEF_B, W2],
        field_sirius_json: jsonField(fullPayload({ acceptTs: ACCEPT_TS, disclaimerTs: ACCEPT_TS })),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910109,
      title: "TEST unexpected offline keys",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("signed"),
        field_sirius_log_handler: [DEF_B, W1],
        field_sirius_json: jsonField(fullPayload({ acceptTs: ACCEPT_TS, esig: true, offline: true })),
      },
    },
    {
      bundle: "sirius_log",
      nid: 99910110,
      title: "TEST unmapped worker handler",
      fields: {
        field_sirius_category: scalar("cardcheck"),
        field_sirius_type: scalar("signed"),
        field_sirius_log_handler: [DEF_A, UNMAPPED_WORKER],
        field_sirius_json: jsonField(fullPayload({ acceptTs: ACCEPT_TS, esig: true })),
      },
    },
  ];

  for (const r of rows) {
    await db.execute(sql`
      INSERT INTO s1_staging.records (bundle, nid, vid, title, uid, status, created, changed, fields)
      VALUES (${r.bundle}, ${r.nid}, ${r.nid}, ${r.title}, 1, 1, ${CREATED_EPOCH}, ${CREATED_EPOCH}, ${JSON.stringify(r.fields)}::jsonb)
      ON CONFLICT (bundle, nid) DO UPDATE SET
        title = EXCLUDED.title, fields = EXCLUDED.fields, extracted_at = now()
    `);
  }
  console.log(
    `seeded ${rows.length} fake staged cardcheck rows (workers ${W1}, ${W2}; defs ${DEF_A}, ${DEF_B})`,
  );
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
