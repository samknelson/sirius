/**
 * DEV-ONLY fleet-rehearsal mutation helper (RUNBOOK §11 rehearsal validation).
 *
 * Simulates "S1 changed between dailies" by editing/deleting rows in the
 * REHEARSAL TARGET's staging schema — hash-correct (all writes go through
 * lib/staging upsert helpers so content_hash matches what a real restage
 * would produce), snapshot-first (every touched row is saved before change
 * so --restore can put the source back verbatim).
 *
 * Mutations applied by --apply (one of each class the dual-run cares about):
 *   people   — mapped contact phone edit
 *   config   — payment-type term rename
 *   benefic. — owned worker's beneficiary percents 50/50 → 60/40
 *   cardcheck— mapped record payload touch (changed+1) ......... updated
 *            — mapped SIGNED record staged row DELETED ......... pending_retention
 *   election — mapped election start date +1 day .............. updated
 *   months   — mapped benefit span end date +32 days .......... month delta
 *   money    — raw AR (Cleared) amount +1.00 .................. updated
 *            — raw AR (Cleared) row DELETED ................... swept
 *            — mapped Cleared payment node DELETED ............ swept + cascade
 *   people   — mapped worker (with owned beneficiaries) DELETED
 *              ............ deleted_in_s1 + source_worker_missing
 *
 * The deleted worker is chosen so its contact email matches NO staged user
 * account (t27 keeps migration-owned links while a worker resolves; a
 * vanished worker must not trip the users verify).
 *
 * Output: aggregate JSON (synthetic nids/tids only — dev data). PRODUCTION:
 * NEVER used; this script refuses non-dev-looking targets by requiring
 * S1_FLEET_SMOKE=1 in the environment (the driver sets it).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/dev/fleet-smoke-mutate.ts --apply   [--snapshot-file <p>]
 *   npx tsx scripts/s1-migration/dev/fleet-smoke-mutate.ts --restore [--snapshot-file <p>]
 */
import * as fs from "fs";
import { getEnvironmentVariable } from "../lib/script-env";
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import {
  ensureStagingSchema,
  upsertRecords,
  upsertTerms,
  upsertRawLedger,
  loadRawLedger,
  type StagedRecord,
  type StagedTerm,
  type RawLedgerRow,
} from "../lib/staging";

const APPLY = process.argv.includes("--apply");
const RESTORE = process.argv.includes("--restore");
const fileIdx = process.argv.indexOf("--snapshot-file");
const SNAPSHOT_FILE = fileIdx >= 0 ? process.argv[fileIdx + 1] : "/tmp/s1-fleet-smoke-snapshot.json";

if (APPLY === RESTORE) {
  console.error("Usage: fleet-smoke-mutate.ts --apply|--restore [--snapshot-file <path>]");
  process.exit(1);
}
  if (getEnvironmentVariable("S1_FLEET_SMOKE") !== "1") {
  console.error("FAIL: refusing to mutate staging without S1_FLEET_SMOKE=1 (dev fleet-rehearsal only)");
  process.exit(1);
}

interface Snapshot {
  records: StagedRecord[];
  terms: StagedTerm[];
  rawLedger: RawLedgerRow[];
  deletedRecords: Array<{ bundle: string; nid: number }>;
  deletedRawLedgerIds: number[];
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(q);
  return (res as unknown as { rows: T[] }).rows;
}

async function getRecord(bundle: string, nid: number): Promise<StagedRecord> {
  const r = await rows<Record<string, unknown>>(
    sql`SELECT bundle, nid, vid, title, uid, status, created, changed, fields
          FROM s1_staging.records WHERE bundle = ${bundle} AND nid = ${nid}`,
  );
  if (r.length !== 1) throw new Error(`staged record ${bundle}/${nid} not found`);
  const x = r[0];
  return {
    bundle: String(x.bundle),
    nid: Number(x.nid),
    vid: x.vid == null ? null : Number(x.vid),
    title: x.title == null ? null : String(x.title),
    uid: x.uid == null ? null : Number(x.uid),
    status: x.status == null ? null : Number(x.status),
    created: x.created == null ? null : Number(x.created),
    changed: x.changed == null ? null : Number(x.changed),
    fields: (x.fields ?? {}) as Record<string, unknown>,
  };
}

/** Drupal field payload access: string | {value} | [{value}] | {und:[{value}]}. */
function readFieldString(field: unknown): { text: string; write: (s: string) => unknown } | null {
  if (typeof field === "string") return { text: field, write: (s) => s };
  if (Array.isArray(field) && field.length > 0 && field[0] && typeof field[0] === "object" && typeof (field[0] as any).value === "string") {
    return {
      text: (field[0] as any).value,
      write: (s) => [{ ...(field[0] as object), value: s }, ...field.slice(1)],
    };
  }
  if (field && typeof field === "object" && typeof (field as any).value === "string") {
    return { text: (field as any).value, write: (s) => ({ ...(field as object), value: s }) };
  }
  return null;
}

function shiftDateString(v: string, days: number): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`unrecognized date value shape`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  const out = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return out + v.slice(10);
}

async function apply() {
  await ensureStagingSchema();
  const snap: Snapshot = { records: [], terms: [], rawLedger: [], deletedRecords: [], deletedRawLedgerIds: [] };
  const report: Record<string, unknown> = {};

  // --- worker to DELETE: mapped + beneficiary-owned + parseable JSON with
  // populated rows + contact email absent from staged users ----------------
  const workerCands = await rows<{ nid: string }>(sql`
    SELECT r.nid FROM s1_staging.records r
      JOIN s1_staging.id_map w ON w.entity = 'worker' AND w.s1_id = r.nid AND w.stub = false
      JOIN s1_staging.id_map b ON b.entity = 'bao-beneficiaries' AND b.s1_id = r.nid
     WHERE r.bundle = 'sirius_worker'
       -- Exclude workers referenced by an employee node whose code is
       -- duplicated across staged employee nodes: deleting such a worker
       -- dangles its node (worker_ref_missing), shifts the in-run
       -- duplicate-code winner, and manufactures a spurious
       -- code_owned_by_other_worker reject against the retained S2 row.
       AND NOT EXISTS (
         SELECT 1 FROM s1_staging.records e
          WHERE e.bundle = 'sirius_employee'
            AND COALESCE(e.fields #>> '{field_sirius_worker,target_id}',
                         e.fields #>> '{field_sirius_worker,0,target_id}',
                         e.fields #>> '{field_sirius_worker,0}',
                         CASE WHEN jsonb_typeof(e.fields -> 'field_sirius_worker') IN ('number','string')
                              THEN e.fields ->> 'field_sirius_worker' END)::bigint = r.nid
            AND EXISTS (
              SELECT 1 FROM s1_staging.records e2
               WHERE e2.bundle = 'sirius_employee' AND e2.nid <> e.nid
                 AND COALESCE(e2.fields #>> '{field_sirius_id,value}', e2.fields ->> 'field_sirius_id')
                     = COALESCE(e.fields #>> '{field_sirius_id,value}', e.fields ->> 'field_sirius_id')
            )
       )
       AND NOT EXISTS (
         SELECT 1 FROM s1_staging.records c
           JOIN s1_staging.raw_users u ON lower(u.mail) = lower(c.fields #>> '{field_sirius_email,value}')
                                        OR lower(u.mail) = lower(c.fields ->> 'field_sirius_email')
          WHERE c.bundle = 'sirius_contact'
            AND c.nid = COALESCE(r.fields #>> '{field_sirius_contact,target_id}',
                               r.fields #>> '{field_sirius_contact,0,target_id}',
                               r.fields #>> '{field_sirius_contact,0}',
                               CASE WHEN jsonb_typeof(r.fields -> 'field_sirius_contact') IN ('number','string')
                                    THEN r.fields ->> 'field_sirius_contact' END)::bigint
       )
     ORDER BY r.nid
  `);
  let deleteWorkerNid: number | null = null;
  let pctWorker: { rec: StagedRecord; payload: { text: string; write: (s: string) => unknown }; parsed: any } | null = null;
  for (const c of workerCands) {
    const rec = await getRecord("sirius_worker", Number(c.nid));
    const payload = readFieldString(rec.fields["field_sirius_json"]);
    if (!payload) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(payload.text);
    } catch {
      continue; // bad_json trap worker — leave it alone
    }
    const primary = parsed?.beneficiaries?.primary;
    if (!Array.isArray(primary) || primary.length === 0) continue;
    deleteWorkerNid = rec.nid;
    snap.records.push(rec);
    break;
  }
  if (deleteWorkerNid == null) throw new Error("no deletable owned worker candidate found");
  // Percent-edit candidate: needs NONE of the delete-target exclusions (the
  // edit deletes nothing, so user links and duplicate-code dedup are
  // unaffected) — scan ALL bene-mapped workers except the delete target for
  // exactly 2 primary rows each carrying a 50-valued prop.
  const pctCands = await rows<{ nid: string }>(sql`
    SELECT r.nid FROM s1_staging.records r
      JOIN s1_staging.id_map b ON b.entity = 'bao-beneficiaries' AND b.s1_id = r.nid
     WHERE r.bundle = 'sirius_worker'
     ORDER BY r.nid
  `);
  for (const c of pctCands) {
    if (Number(c.nid) === deleteWorkerNid) continue;
    const rec = await getRecord("sirius_worker", Number(c.nid));
    const payload = readFieldString(rec.fields["field_sirius_json"]);
    if (!payload) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(payload.text);
    } catch {
      continue; // bad_json trap worker — leave it alone
    }
    const primary = parsed?.beneficiaries?.primary;
    if (!Array.isArray(primary) || primary.length !== 2) continue;
    const fifty = (row: any) => Object.keys(row ?? {}).find((k) => Number.parseFloat(String(row[k])) === 50);
    if (fifty(primary[0]) && fifty(primary[1])) {
      pctWorker = { rec, payload, parsed };
      break;
    }
  }
  if (pctWorker == null) throw new Error("no 50/50 beneficiary worker candidate found");

  // percent edit 50/50 → 60/40 (string-typed values stay strings)
  {
    const primary = pctWorker.parsed.beneficiaries.primary;
    const applyPct = (row: any, v: string) => {
      const k = Object.keys(row).find((kk) => Number.parseFloat(String(row[kk])) === 50)!;
      row[k] = typeof row[k] === "number" ? Number(v) : v;
    };
    snap.records.push(await getRecord("sirius_worker", pctWorker.rec.nid)); // pristine copy
    applyPct(primary[0], "60");
    applyPct(primary[1], "40");
    pctWorker.rec.fields = { ...pctWorker.rec.fields, field_sirius_json: pctWorker.payload.write(JSON.stringify(pctWorker.parsed)) };
    await upsertRecords([pctWorker.rec]);
    report.beneficiaryPctEdit = pctWorker.rec.nid;
  }

  // --- contact phone edit ---------------------------------------------------
  {
    const cands = await rows<{ nid: string }>(sql`
      SELECT r.nid FROM s1_staging.records r
        JOIN s1_staging.id_map m ON m.entity = 'contact' AND m.s1_id = r.nid AND m.stub = false
       WHERE r.bundle = 'sirius_contact' AND r.fields ? 'field_sirius_phone'
       ORDER BY r.nid
    `);
    let done = false;
    for (const c of cands) {
      const rec = await getRecord("sirius_contact", Number(c.nid));
      const payload = readFieldString(rec.fields["field_sirius_phone"]);
      if (!payload || !/\d/.test(payload.text)) continue;
      snap.records.push(await getRecord("sirius_contact", rec.nid));
      const digits = payload.text.replace(/\d(?=\D*$)/, (d) => String((Number(d) + 1) % 10)); // bump last digit
      rec.fields = { ...rec.fields, field_sirius_phone: payload.write(digits) };
      await upsertRecords([rec]);
      report.contactPhoneEdit = rec.nid;
      done = true;
      break;
    }
    if (!done) throw new Error("no mapped contact with a phone value found");
  }

  // --- payment-type term rename ----------------------------------------------
  {
    const t = await rows<Record<string, unknown>>(sql`
      SELECT tid, vocabulary, name, description, weight, fields
        FROM s1_staging.terms WHERE vocabulary = 'sirius_payment_type' ORDER BY tid LIMIT 1
    `);
    if (t.length !== 1) throw new Error("no sirius_payment_type term staged");
    const term: StagedTerm = {
      tid: Number(t[0].tid),
      vocabulary: String(t[0].vocabulary),
      name: String(t[0].name),
      description: t[0].description == null ? null : String(t[0].description),
      weight: Number(t[0].weight ?? 0),
      fields: (t[0].fields ?? {}) as Record<string, unknown>,
    };
    snap.terms.push({ ...term });
    await upsertTerms([{ ...term, name: `${term.name} (renamed)` }]);
    report.termRename = term.tid;
  }

  // --- cardcheck payload touch + SIGNED record deletion ----------------------
  {
    const touch = await getRecord("sirius_log", 99910101); // signed clean fake
    snap.records.push({ ...touch, fields: touch.fields });
    await upsertRecords([{ ...touch, changed: (touch.changed ?? 0) + 1 }]);
    report.cardcheckTouch = touch.nid;

    const mapped = await rows<{ s1_id: string }>(
      sql`SELECT s1_id FROM s1_staging.id_map WHERE entity = 'cardcheck' AND s1_id = 99910107 AND stub = false`,
    );
    if (mapped.length !== 1) throw new Error("cardcheck fake 99910107 is not mapped — run the fleet sync first");
    snap.records.push(await getRecord("sirius_log", 99910107));
    snap.deletedRecords.push({ bundle: "sirius_log", nid: 99910107 });
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_log' AND nid = 99910107`);
    report.cardcheckRetentionDelete = 99910107;
  }

  // --- election start-date edit ----------------------------------------------
  {
    const cands = await rows<{ nid: string }>(sql`
      SELECT r.nid FROM s1_staging.records r
        JOIN s1_staging.id_map m ON m.entity = 'election' AND m.s1_id = r.nid AND m.stub = false
       WHERE r.bundle = 'sirius_trust_worker_election' AND r.fields ? 'field_sirius_date_start'
       ORDER BY r.nid
    `);
    let done = false;
    for (const c of cands) {
      const rec = await getRecord("sirius_trust_worker_election", Number(c.nid));
      const payload = readFieldString(rec.fields["field_sirius_date_start"]);
      if (!payload || !/^\d{4}-\d{2}-\d{2}/.test(payload.text)) continue;
      snap.records.push(await getRecord("sirius_trust_worker_election", rec.nid));
      rec.fields = { ...rec.fields, field_sirius_date_start: payload.write(shiftDateString(payload.text, 1)) };
      await upsertRecords([rec]);
      report.electionStartEdit = rec.nid;
      done = true;
      break;
    }
    if (!done) throw new Error("no mapped election with a start date found");
  }

  // --- benefit span end-date +32 days (guaranteed month delta) ----------------
  {
    const cands = await rows<{ nid: string }>(sql`
      SELECT r.nid FROM s1_staging.records r
       WHERE r.bundle = 'sirius_trust_worker_benefit' AND r.fields ? 'field_sirius_date_end'
       ORDER BY r.nid
    `);
    let done = false;
    for (const c of cands) {
      const rec = await getRecord("sirius_trust_worker_benefit", Number(c.nid));
      const payload = readFieldString(rec.fields["field_sirius_date_end"]);
      if (!payload || !/^\d{4}-\d{2}-\d{2}/.test(payload.text)) continue;
      snap.records.push(await getRecord("sirius_trust_worker_benefit", rec.nid));
      rec.fields = { ...rec.fields, field_sirius_date_end: payload.write(shiftDateString(payload.text, 32)) };
      await upsertRecords([rec]);
      report.benefitSpanEndEdit = rec.nid;
      done = true;
      break;
    }
    if (!done) throw new Error("no closed benefit span with an end date found");
  }

  // --- money: raw AR edit, raw AR delete, payment node delete -----------------
  {
    const all = await loadRawLedger();
    const cleared = all.filter((r) => (r.status ?? "").toLowerCase() === "cleared");
    if (cleared.length < 2) throw new Error("need ≥2 Cleared raw AR rows");
    const edit = cleared[0];
    const del = cleared[1];
    snap.rawLedger.push({ ...edit }, { ...del });
    const amt = (Number.parseFloat(edit.amount ?? "0") + 1).toFixed(2);
    await upsertRawLedger([{ ...edit, amount: amt }]);
    snap.deletedRawLedgerIds.push(del.ledgerId);
    await db.execute(sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id = ${del.ledgerId}`);
    report.arAmountEdit = edit.ledgerId;
    report.arRowDelete = del.ledgerId;

    const pay = await rows<{ nid: string }>(sql`
      SELECT r.nid FROM s1_staging.records r
        JOIN s1_staging.id_map m ON m.entity = 'payment' AND m.s1_id = r.nid AND m.stub = false
       WHERE r.bundle = 'sirius_payment'
         AND COALESCE(r.fields #>> '{field_sirius_payment_status,value}', r.fields ->> 'field_sirius_payment_status') = 'Cleared'
       ORDER BY r.nid LIMIT 1
    `);
    if (pay.length !== 1) throw new Error("no mapped Cleared payment found");
    const payNid = Number(pay[0].nid);
    snap.records.push(await getRecord("sirius_payment", payNid));
    snap.deletedRecords.push({ bundle: "sirius_payment", nid: payNid });
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_payment' AND nid = ${payNid}`);
    report.paymentDelete = payNid;
  }

  // --- finally: DELETE the owned worker (after all selects that used it) ------
  {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${deleteWorkerNid}`);
    snap.deletedRecords.push({ bundle: "sirius_worker", nid: deleteWorkerNid });
    report.workerDelete = deleteWorkerNid;
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap));
  console.log(JSON.stringify({ applied: report, snapshotFile: SNAPSHOT_FILE }, null, 2));
}

async function restore() {
  await ensureStagingSchema();
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as Snapshot;
  // Upserts recompute content_hash from the restored content — identical to a
  // real S1 restage of the original data.
  // De-dup records by (bundle, nid): the pct-edit worker was snapshotted twice
  // (pristine copy taken before both the edit and any later delete); LAST copy
  // per key is the pristine one only when order is [pre-edit, ...]; keep FIRST.
  const seen = new Set<string>();
  const recs: StagedRecord[] = [];
  for (const r of snap.records) {
    const k = `${r.bundle}/${r.nid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    recs.push(r);
  }
  if (recs.length) await upsertRecords(recs);
  if (snap.terms.length) await upsertTerms(snap.terms);
  if (snap.rawLedger.length) await upsertRawLedger(snap.rawLedger);
  console.log(
    JSON.stringify(
      { restored: { records: recs.length, terms: snap.terms.length, rawLedger: snap.rawLedger.length } },
      null,
      2,
    ),
  );
}

async function main() {
  if (APPLY) await apply();
  else await restore();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
