/**
 * Sync smoke — people loaders (Task 293): T3/T1 contacts+workers,
 * T15 relationships, N4 employee ids.
 *
 * Proves full reconcile semantics against the dev DB:
 *   1. create   — seed staged fakes, first load builds S2 rows
 *   2. update   — staged edits (rename, email, phone drop, address change,
 *                 dob, relationship fields, employee-id value) converge on
 *                 re-run; phone/address collections reconcile as sets
 *   3. fastpath — a no-edit T15 rerun writes nothing (updated=created=0)
 *   4. delete   — S1-deleted relationship/employee-id rows are swept
 *                 (hard delete); S1-deleted contact/worker are REPORT-ONLY
 *                 (rows persist, deleted_in_s1 findings emitted)
 *
 * DEV-ONLY (seeds + deletes staged fakes and their S2 rows). Fake nids live
 * in 99901000–99901099; fake reltype tid 99901090 maps to a real relation
 * type option. NEVER prints emails/notes (HIPAA bar) — asserts compare in
 * code and log pass/fail only.
 *
 * NOTE: the first converted run over a dev DB reprocesses the whole staged
 * population (pre-sync mappings carry null fingerprints) — expect the first
 * T3/T1 run to be slow; later runs ride the fast path.
 *
 * Run: npx tsx scripts/oneoffs/s1-sync-people-smoke.ts
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords } from "../s1-migration/lib/staging";
import { ensureIdMap, putMapping } from "../s1-migration/lib/idmap";

const N = {
  ct1: 99901001, // primary contact (update-path subject)
  ct2: 99901002, // alt contact (report-only deletion subject)
  ct3: 99901003, // stale SSN owner's contact
  ct4: 99901004, // incoming SSN claimant's contact
  wk1: 99901011, // worker of ct1
  wk2: 99901012, // worker of ct2 (report-only deletion subject)
  wk3: 99901013, // source-missing stale SSN owner
  wk4: 99901014, // incoming SSN claimant
  rel1: 99901021, // relationship ct1↔ct2 (hard-delete sweep subject)
  emp1: 99901031, // employee id on wk1 (hard-delete sweep subject)
  reltypeTid: 99901090, // fake term tid → real relation type option
};
const NID_LO = 99901000;
const NID_HI = 99901099;
const SMOKE_LOADER = "s1-sync-people-smoke";

// Dev-data allowances (documented; extend only with triaged justification).
// deleted_in_s1 findings are allowed on every T3/T1 run: report-only sweeps
// re-emit findings each run and dev may carry dangling mappings from earlier
// exercises — the smoke asserts OUR nids explicitly instead.
// T3/T1 dev-population allowances: full reconcile re-validates EVERY staged
// row (the old partial path skipped mapped rows), surfacing pre-existing
// synthetic-data collisions (16/71/4/3 as of 2026-08-19, stable across runs;
// rejected rows never advance their fingerprint, so they recur every run).
// Our own fixture nids are asserted explicitly below, so these allowances
// cannot mask fixture regressions.
const T3_ALLOW_REJECTS = [
  "duplicate_email",
  "worker_id_value_collision",
  "ssn_collision_q36",
  "worker_contact_unresolved",
];
const T15_ALLOW_REJECTS = ["owner_missing"]; // pre-existing dev staging gap
// worker_ref_missing: pre-existing dev staging gap. duplicate_code /
// code_owned_by_other_worker: one synthetic staged pair shares a code — the
// first run rejects both as duplicate_code; once one side is adopted, later
// runs reject the loser as code_owned_by_other_worker (2 → 1+1, stable).
const N4_ALLOW_REJECTS = ["worker_ref_missing", "duplicate_code", "code_owned_by_other_worker"];

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(script: string, args: string[] = [], timeoutMs = 900_000): { status: number; result: any } {
  const tmp = path.join(os.tmpdir(), `s1-smoke-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, S1_RESULT_JSON_PATH: tmp },
  });
  let result: any = {};
  try {
    result = JSON.parse(fs.readFileSync(tmp, "utf8"));
  } catch {
    /* asserts fail loudly on missing result */
  }
  try {
    fs.unlinkSync(tmp);
  } catch {}
  if ((res.status ?? -1) !== 0) {
    const tail = (res.stderr ?? "").split("\n").filter(Boolean).slice(-8).join("\n    ");
    console.error(`  [${script} exit ${res.status}] stderr tail:\n    ${tail}`);
  }
  return { status: res.status ?? -1, result };
}

const allowArgs = (rejects: string[], findings: string[] = []) => [
  ...(rejects.length > 0 ? ["--allow-rejects", rejects.join(",")] : []),
  ...(findings.length > 0 ? ["--allow-findings", findings.join(",")] : []),
];

const runT3 = (extraFindings: string[] = [], extraArgs: string[] = []) =>
  runLoader("load-contacts-workers.ts", [...allowArgs(T3_ALLOW_REJECTS, ["deleted_in_s1", ...extraFindings]), ...extraArgs]);
const runT15 = () => runLoader("load-relationships.ts", allowArgs(T15_ALLOW_REJECTS), 600_000);
const runN4 = () => runLoader("load-employee-ids.ts", allowArgs(N4_ALLOW_REJECTS), 600_000);

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}
async function mappingOf(entity: string, s1Id: number): Promise<{ s2Id: string; stub: boolean } | null> {
  const r = await rows<{ s2_id: string; stub: boolean }>(
    sql`SELECT s2_id, stub FROM s1_staging.id_map WHERE entity = ${entity} AND s1_id = ${s1Id}`,
  );
  return r.length > 0 ? { s2Id: r[0].s2_id, stub: r[0].stub } : null;
}

// ---------------------------------------------------------------------------
// staged fixtures
// ---------------------------------------------------------------------------
const now = Math.floor(Date.UTC(2026, 1, 1) / 1000); // 2026-02-01

interface ContactSeed {
  given: string;
  family: string;
  email: string | null;
  phone?: string;
  phoneAlt?: string;
  city?: string;
}
const contactRec = (nid: number, s: ContactSeed) => ({
  bundle: "sirius_contact",
  nid,
  vid: nid,
  title: `${s.given} ${s.family}`,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: {
    field_sirius_name: { given: s.given, family: s.family },
    ...(s.email ? { field_sirius_email: { value: s.email } } : {}),
    ...(s.phone ? { field_sirius_phone: { value: s.phone } } : {}),
    ...(s.phoneAlt ? { field_sirius_phone_alt: { value: s.phoneAlt } } : {}),
    ...(s.city
      ? {
          field_sirius_address: {
            thoroughfare: "1 Smoke Test Way",
            locality: s.city,
            administrative_area: "MA",
            postal_code: "02101",
            country: "US",
          },
        }
      : {}),
  },
});

const workerRec = (nid: number, contactNid: number, siriusId: string, dob?: string, ssn?: string) => ({
  bundle: "sirius_worker",
  nid,
  vid: nid,
  title: `Worker ${nid}`,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: {
    field_sirius_contact: { target_id: contactNid },
    field_sirius_id: { value: siriusId },
    ...(dob ? { field_sirius_dob: { value: `${dob} 00:00:00` } } : {}),
    ...(ssn ? { field_sirius_ssn: { value: ssn } } : {}),
  },
});

const relRec = (nid: number, ownerContact: number, altContact: number, seq: number, endYmd?: string) => ({
  bundle: "sirius_contact_relationship",
  nid,
  vid: nid,
  title: `Rel ${nid}`,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: {
    field_sirius_contact: { target_id: ownerContact },
    field_sirius_contact_alt: { target_id: altContact },
    field_sirius_contact_reltype: { tid: N.reltypeTid },
    field_sirius_date_start: { value: "2020-01-01 00:00:00" },
    ...(endYmd ? { field_sirius_date_end: { value: `${endYmd} 00:00:00` } } : {}),
    field_sirius_active: { value: "Yes" },
    field_sirius_count: { value: seq },
  },
});

const empRec = (nid: number, workerNid: number, shopNid: number, value: string) => ({
  bundle: "sirius_employee",
  nid,
  vid: nid,
  title: `Employee ${nid}`,
  uid: 1,
  status: 1,
  created: now,
  changed: now,
  fields: {
    field_sirius_worker: { target_id: workerNid },
    field_grievance_shop: { target_id: shopNid },
    field_sirius_id: { value },
  },
});

// ---------------------------------------------------------------------------
// cleanup (idempotent; run before seeding AND in finally)
// ---------------------------------------------------------------------------
async function cleanup() {
  const maps = await rows<{ entity: string; s1_id: string; s2_id: string }>(
    sql`SELECT entity, s1_id, s2_id FROM s1_staging.id_map
        WHERE entity IN ('contact','worker','relation','employee-id')
          AND s1_id BETWEEN ${NID_LO} AND ${NID_HI}`,
  );
  const ids = (entity: string) => maps.filter((m) => m.entity === entity).map((m) => m.s2_id);
  const workerIds = ids("worker");
  const contactIds = ids("contact");
  const inList = (arr: string[]) => sql.join(arr.map((x) => sql`${x}`), sql`, `);

  if (workerIds.length > 0) {
    await db.execute(sql`DELETE FROM worker_relations WHERE worker_1 IN (${inList(workerIds)}) OR worker_2 IN (${inList(workerIds)})`);
    await db.execute(sql`DELETE FROM worker_ids WHERE worker_id IN (${inList(workerIds)})`);
    await db.execute(sql`DELETE FROM worker_msh WHERE worker_id IN (${inList(workerIds)})`);
    await db.execute(sql`DELETE FROM workers WHERE id IN (${inList(workerIds)})`);
  }
  if (contactIds.length > 0) {
    await db.execute(sql`DELETE FROM contact_phone WHERE contact_id IN (${inList(contactIds)})`);
    await db.execute(sql`DELETE FROM contact_postal WHERE contact_id IN (${inList(contactIds)})`);
    await db.execute(sql`DELETE FROM contacts WHERE id IN (${inList(contactIds)})`);
  }
  await db.execute(
    sql`DELETE FROM s1_staging.records
        WHERE nid BETWEEN ${NID_LO} AND ${NID_HI}
          AND bundle IN ('sirius_contact','sirius_worker','sirius_contact_relationship','sirius_employee')`,
  );
  await db.execute(
    sql`DELETE FROM s1_staging.id_map
        WHERE (entity IN ('contact','worker','relation','employee-id') AND s1_id BETWEEN ${NID_LO} AND ${NID_HI})
           OR (entity = 'term' AND s1_id = ${N.reltypeTid})`,
  );
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  await cleanup(); // crashed-run remnants

  // ---- real dev prerequisites ---------------------------------------------
  const relType = await rows<{ id: string }>(sql`SELECT id FROM options_worker_relation_type ORDER BY id LIMIT 1`);
  const shopMap = await rows<{ s1_id: string; s2_id: string }>(
    sql`SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m JOIN employers e ON e.id = m.s2_id
        WHERE m.entity = 'employer' AND NOT m.stub ORDER BY m.s1_id LIMIT 1`,
  );
  if (relType.length < 1 || shopMap.length < 1) {
    console.error("SETUP FAIL: need ≥1 relation type option and ≥1 mapped employer in the dev DB.");
    process.exit(1);
  }
  const relTypeOptId = relType[0].id;
  const shopNid = Number(shopMap[0].s1_id);
  await putMapping("term", N.reltypeTid, relTypeOptId, { stub: false, loader: SMOKE_LOADER });

  try {
    // =========================================================== phase 1: create
    console.log("phase 1: seed + first load (create paths)");
    await upsertRecords([
      contactRec(N.ct1, { given: "Sync", family: "Doe", email: "sync-doe-999@example.com", phone: "617-555-0101", phoneAlt: "617-555-0102", city: "Boston" }),
      contactRec(N.ct2, { given: "Alt", family: "Person", email: null }),
      contactRec(N.ct3, { given: "Stale", family: "Owner", email: null }),
      contactRec(N.ct4, { given: "Incoming", family: "Claimant", email: null }),
      workerRec(N.wk1, N.ct1, "99901011", "1980-01-01"),
      workerRec(N.wk2, N.ct2, "99901012"),
      workerRec(N.wk3, N.ct3, "99901013", undefined, "111-22-3333"),
      workerRec(N.wk4, N.ct4, "99901014", undefined, "111223333"),
      relRec(N.rel1, N.ct1, N.ct2, 1),
      empRec(N.emp1, N.wk1, shopNid, "EMP-999010"),
    ]);

    let t3 = runT3();
    check("t3t1 run 1 exits 0", t3.status === 0, t3.result?.rejectGate ?? t3.result?.blockingFindings);
    const c1 = await mappingOf("contact", N.ct1);
    const c2 = await mappingOf("contact", N.ct2);
    const w1 = await mappingOf("worker", N.wk1);
    const w2 = await mappingOf("worker", N.wk2);
    const w3 = await mappingOf("worker", N.wk3);
    const w4 = await mappingOf("worker", N.wk4);
    check("contacts + workers mapped", !!c1 && !!c2 && !!w1 && !!w2 && !!w3 && !!w4 && [c1, c2, w1, w2, w3, w4].every((m) => !m!.stub));
    if (!c1 || !c2 || !w1 || !w2) throw new Error("cannot continue without phase-1 mappings");
    if (!w3 || !w4) throw new Error("cannot continue without SSN fixture mappings");
    const initialSsnRows = await rows<{ id: string; ssn: string | null }>(
      sql`SELECT id, ssn FROM workers WHERE id IN (${w3.s2Id}, ${w4.s2Id})`,
    );
    check(
      "live owner collision is refused",
      initialSsnRows.find((r) => r.id === w3.s2Id)?.ssn === "111223333" &&
        initialSsnRows.find((r) => r.id === w4.s2Id)?.ssn == null,
    );

    // Simulate an already-consumed unchanged incoming fingerprint, then make
    // the current owner source-missing. The repair dependency must bypass the
    // normal fast path even though wk4's staged content did not change.
    await db.execute(sql`
      UPDATE s1_staging.id_map
         SET consumed_fingerprint = (SELECT content_hash FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${N.wk4}),
             logic_version = 2
       WHERE entity = 'worker' AND s1_id = ${N.wk4}
    `);
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${N.wk3}`);

    const ssnDry = runT3([], ["--dry-run"]);
    check("SSN transfer dry-run exits 0", ssnDry.status === 0, ssnDry.result?.rejectGate);
    check("SSN transfer dry-run reports one plan", ssnDry.result?.detail?.ssnOwnershipRepairs?.dryRunPlanned === 1, ssnDry.result?.detail?.ssnOwnershipRepairs);
    const afterDry = await rows<{ id: string; ssn: string | null }>(
      sql`SELECT id, ssn FROM workers WHERE id IN (${w3.s2Id}, ${w4.s2Id})`,
    );
    check(
      "SSN transfer dry-run does not mutate",
      afterDry.find((r) => r.id === w3.s2Id)?.ssn === "111223333" &&
        afterDry.find((r) => r.id === w4.s2Id)?.ssn == null,
    );

    const ssnRepair = runT3();
    check("source-missing stale SSN owner repair exits 0", ssnRepair.status === 0, ssnRepair.result?.rejectGate);
    check("SSN repair applied once", ssnRepair.result?.detail?.ssnOwnershipRepairs?.applied === 1, ssnRepair.result?.detail?.ssnOwnershipRepairs);
    const afterRepair = await rows<{ id: string; sirius_id: number; ssn: string | null }>(
      sql`SELECT id, sirius_id, ssn FROM workers WHERE id IN (${w3.s2Id}, ${w4.s2Id})`,
    );
    check(
      "unchanged incoming fingerprint still repairs unique SSN ownership",
      afterRepair.find((r) => r.id === w3.s2Id)?.ssn == null &&
        afterRepair.find((r) => r.id === w4.s2Id)?.ssn === "111223333",
    );
    check(
      "SSN-only transfer preserves both workers and Sirius IDs",
      afterRepair.length === 2 &&
        Number(afterRepair.find((r) => r.id === w3.s2Id)?.sirius_id) === 99901013 &&
        Number(afterRepair.find((r) => r.id === w4.s2Id)?.sirius_id) === 99901014,
      afterRepair.map((r) => ({ id: r.id, siriusId: r.sirius_id, hasSsn: r.ssn != null })),
    );

    const contact1 = (await rows<any>(sql`SELECT display_name, email, birth_date FROM contacts WHERE id = ${c1.s2Id}`))[0];
    check("ct1 display name", !!contact1 && String(contact1.display_name).includes("Sync") && String(contact1.display_name).includes("Doe"), contact1?.display_name);
    check("ct1 email loaded", contact1?.email === "sync-doe-999@example.com");
    check("ct1 dob from worker", String(contact1?.birth_date).startsWith("1980-01-01"), contact1?.birth_date);
    const worker1 = (await rows<any>(sql`SELECT sirius_id FROM workers WHERE id = ${w1.s2Id}`))[0];
    // workers.sirius_id is a serial (integer) column — compare numerically
    check("wk1 sirius_id", Number(worker1?.sirius_id) === 99901011, worker1?.sirius_id);
    const phones1 = await rows<any>(sql`SELECT phone_number, friendly_name FROM contact_phone WHERE contact_id = ${c1.s2Id} ORDER BY friendly_name`);
    check("ct1 has Primary + Alt phones", phones1.length === 2 && phones1.some((p) => p.friendly_name === "Primary" && p.phone_number === "+16175550101") && phones1.some((p) => p.friendly_name === "Alt" && p.phone_number === "+16175550102"), phones1);
    // deleteContactPostal soft-deletes (is_active=false) — assert active rows only
    const postal1 = await rows<any>(sql`SELECT id, city, source FROM contact_postal WHERE contact_id = ${c1.s2Id} AND is_active = true`);
    check("ct1 import address (Boston)", postal1.length === 1 && postal1[0].city === "Boston" && postal1[0].source === "import", postal1);
    const postalIdBefore = postal1[0]?.id;

    const t15a = runT15();
    check("t15 run 1 exits 0", t15a.status === 0, t15a.result?.rejectGate);
    const relMap = await mappingOf("relation", N.rel1);
    check("relationship mapped", !!relMap && !relMap.stub);
    const rel1 = (await rows<any>(
      sql`SELECT relation_type, start_ymd, end_ymd, data FROM worker_relations WHERE worker_1 = ${w1.s2Id} AND worker_2 = ${w2.s2Id}`,
    ))[0];
    check("relation row created", !!rel1 && rel1.relation_type === relTypeOptId && String(rel1.start_ymd).startsWith("2020-01-01") && rel1.end_ymd == null, rel1);
    check("relation sequence=1", Number(rel1?.data?.sequence) === 1, rel1?.data);

    const n4a = runN4();
    check("n4 run 1 exits 0", n4a.status === 0, n4a.result?.rejectGate);
    const empMap = await mappingOf("employee-id", N.emp1);
    check("employee-id mapped", !!empMap && !empMap.stub);
    const wid1 = await rows<any>(sql`SELECT value FROM worker_ids WHERE worker_id = ${w1.s2Id}`);
    check("worker id EMP-999010 created", wid1.some((r) => r.value === "EMP-999010"), wid1.map((r) => r.value));

    // =========================================================== phase 2: update
    console.log("phase 2: staged edits converge on re-run (S1-wins)");
    await upsertRecords([
      // rename, new email, DROP alt phone, move city, keep primary phone
      contactRec(N.ct1, { given: "Sync", family: "Smith", email: "sync-smith-999@example.com", phone: "617-555-0101", city: "Cambridge" }),
      workerRec(N.wk1, N.ct1, "99901011", "1981-02-02"), // dob change
      relRec(N.rel1, N.ct1, N.ct2, 2, "2026-01-31"), // sequence + end date
      empRec(N.emp1, N.wk1, shopNid, "EMP-999011"), // value correction
    ]);

    t3 = runT3();
    check("t3t1 run 2 exits 0", t3.status === 0, t3.result?.rejectGate);
    check("t3t1 run 2 reports updates", (t3.result?.summary?.updated ?? 0) >= 1, t3.result?.summary);
    const contact1b = (await rows<any>(sql`SELECT display_name, email, birth_date FROM contacts WHERE id = ${c1.s2Id}`))[0];
    check("ct1 renamed (Smith)", String(contact1b?.display_name).includes("Smith") && !String(contact1b?.display_name).includes("Doe"), contact1b?.display_name);
    check("ct1 email updated", contact1b?.email === "sync-smith-999@example.com");
    check("ct1 dob updated", String(contact1b?.birth_date).startsWith("1981-02-02"), contact1b?.birth_date);
    const phones2 = await rows<any>(sql`SELECT phone_number, friendly_name FROM contact_phone WHERE contact_id = ${c1.s2Id}`);
    check("alt phone removed, primary kept", phones2.length === 1 && phones2[0].phone_number === "+16175550101", phones2);
    const postal2 = await rows<any>(sql`SELECT id, city, source FROM contact_postal WHERE contact_id = ${c1.s2Id} AND is_active = true`);
    check("address reconciled to Cambridge (old import row deactivated)", postal2.length === 1 && postal2[0].city === "Cambridge" && postal2[0].id !== postalIdBefore, postal2);

    const t15b = runT15();
    check("t15 run 2 exits 0 with updates", t15b.status === 0 && (t15b.result?.summary?.updated ?? 0) >= 1, t15b.result?.summary);
    const rel2 = (await rows<any>(
      sql`SELECT end_ymd, data FROM worker_relations WHERE worker_1 = ${w1.s2Id} AND worker_2 = ${w2.s2Id}`,
    ))[0];
    check("relation end date + sequence updated", !!rel2 && String(rel2.end_ymd).startsWith("2026-01-31") && Number(rel2.data?.sequence) === 2, rel2);

    const n4b = runN4();
    check("n4 run 2 exits 0 with updates", n4b.status === 0 && (n4b.result?.summary?.updated ?? 0) >= 1, n4b.result?.summary);
    const wid2 = await rows<any>(sql`SELECT value FROM worker_ids WHERE worker_id = ${w1.s2Id}`);
    check("worker id value corrected", wid2.some((r) => r.value === "EMP-999011") && !wid2.some((r) => r.value === "EMP-999010"), wid2.map((r) => r.value));

    // =========================================================== phase 3: fast path
    console.log("phase 3: no-edit rerun rides the fingerprint fast path");
    const t15c = runT15();
    check("t15 run 3 writes nothing", t15c.status === 0 && (t15c.result?.summary?.updated ?? -1) === 0 && (t15c.result?.summary?.created ?? -1) === 0, t15c.result?.summary);
    check("t15 run 3 skips unchanged rows", (t15c.result?.summary?.unchanged ?? 0) >= 1, t15c.result?.summary);

    // =========================================================== phase 4: delete
    console.log("phase 4: S1 deletions — child rows swept, people report-only");
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_contact_relationship' AND nid = ${N.rel1}`);
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_employee' AND nid = ${N.emp1}`);

    const t15d = runT15();
    check("t15 sweep run exits 0", t15d.status === 0, t15d.result?.rejectGate);
    check("t15 sweep deleted the relation", (t15d.result?.summary?.deleted ?? 0) >= 1, t15d.result?.summary);
    const rel3 = await rows<any>(sql`SELECT id FROM worker_relations WHERE worker_1 = ${w1.s2Id} AND worker_2 = ${w2.s2Id}`);
    check("relation row gone", rel3.length === 0);
    check("relation mapping gone", (await mappingOf("relation", N.rel1)) === null);

    const n4d = runN4();
    check("n4 sweep run exits 0", n4d.status === 0, n4d.result?.rejectGate);
    check("n4 sweep deleted the worker id", (n4d.result?.summary?.deleted ?? 0) >= 1, n4d.result?.summary);
    // t3t1 owns a "Legacy NID" worker_ids row for every worker — only the
    // n4-owned EMP- value must be gone after the sweep.
    const wid3 = await rows<any>(sql`SELECT value FROM worker_ids WHERE worker_id = ${w1.s2Id}`);
    check("employee-id worker id row gone", !wid3.some((r) => String(r.value).startsWith("EMP-")), wid3.map((r) => r.value));
    check("employee-id mapping gone", (await mappingOf("employee-id", N.emp1)) === null);

    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_contact' AND nid = ${N.ct2}`);
    await db.execute(sql`DELETE FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid = ${N.wk2}`);
    const t3d = runT3();
    check("t3t1 report-only run exits 0", t3d.status === 0, t3d.result?.blockingFindings);
    const stillContact = await rows<any>(sql`SELECT id FROM contacts WHERE id = ${c2.s2Id}`);
    const stillWorker = await rows<any>(sql`SELECT id FROM workers WHERE id = ${w2.s2Id}`);
    check("S1-deleted contact NOT deleted from S2", stillContact.length === 1);
    check("S1-deleted worker NOT deleted from S2", stillWorker.length === 1);
    const findings: any[] = t3d.result?.findings ?? [];
    check(
      "deleted_in_s1 findings emitted for ct2 + wk2",
      findings.some((f) => f.kind === "deleted_in_s1" && f.entity === "contact" && f.s1Id === N.ct2) &&
        findings.some((f) => f.kind === "deleted_in_s1" && f.entity === "worker" && f.s1Id === N.wk2),
      findings.filter((f) => f.kind === "deleted_in_s1").map((f) => `${f.entity}:${f.s1Id}`).slice(0, 20),
    );
    check("t3t1 reportOnly counted", (t3d.result?.summary?.reportOnly ?? 0) >= 2, t3d.result?.summary);
  } finally {
    console.log("cleanup: removing seeded rows + S2 artifacts");
    await cleanup();
  }

  console.log(failures === 0 ? "\nPEOPLE SYNC SMOKE PASS" : `\nPEOPLE SYNC SMOKE FAIL (${failures} failures)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
