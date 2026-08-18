/**
 * Smoke test for the T16–T19 loaders (elections, benefit history, payments,
 * ledger charges). The synthetic dev DB stages structurally sparse rows
 * (elections lack worker refs, wb rows lack dates, payments lack types), so
 * this script seeds FULLY-POPULATED fake staged rows (nids 999001xx–999006xx)
 * against real dev workers/employers/benefits, then runs each loader as a
 * real CLI and asserts:
 *   - T16: typed + untyped + inactive-end-dated elections load; benefit
 *     ORDER preserved; relationship ids resolved; idempotent re-run adopts.
 *   - T17: span→month expansion (closed, open --open-end-through, inactive
 *     end-dated, dependent-via-relation, employer-from-election); re-run
 *     adopts every month; dependent rows carry source_relation_id.
 *   - T19: typed payment path (id_map term → payment-type option) with
 *     currency preflight; cleared payment gets date_cleared + allocated.
 *   - T16 + T19 crash repair: deleting the id_map row and re-running must
 *     re-adopt the existing S2 row by provenance (s1Nid), never duplicate.
 *   - T18: raw AR rows load with reference resolution (trust_wmb via T17's
 *     anchor mapping, ledger_payment via T19), per-account sum parity holds.
 *   - Policies (2026-08-11 rulings): seeder R→UH rename in place (row UUID
 *     preserved) + both-rows abort; alias table resolves "UNITE HERE Plan"
 *     to UH; election refs to a deleted (unstaged) policy nid map to the
 *     Inactive policy with a per-nid mappedToInactive report; and
 *     load-employer-policies (5b) resolves a shop ebh ref to the same
 *     deleted nid through the new id_map entry with no code change.
 * Cleanup removes every fake staged row, id_map entry, and S2 row.
 *
 * Run: npx tsx scripts/oneoffs/s1-t16-t19-smoke.ts
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { ensureStagingSchema, upsertRecords, ensureRawLedgerTable, upsertRawLedger } from "../s1-migration/lib/staging";
import { ensureIdMap, getMappings, putMapping } from "../s1-migration/lib/idmap";

// Fake S1 nids — far above any real/synthetic nid range.
const N = {
  benefit1: 99900101,
  benefit2: 99900102,
  relation: 99900201,
  election1: 99900301, // typed FirstTime, closed span
  election2: 99900302, // untyped, open, carries relation
  election3: 99900303, // untyped, inactive → end-dated from changed
  wb1: 99900401, // closed span 2024-01-15 → 2024-03-10 (3 months, b1)
  wb2: 99900402, // open span 2026-06-01 → through 2026-08 (3 months, b1)
  wb3: 99900403, // dependent via relation (1 month, b1, worker w2)
  wb4: 99900404, // inactive, end-dated from changed (4 months, b2)
  wb5: 99900405, // no shop → employer from election1 (1 month, b2)
  payment: 99900501,
  ar1: 99900601, // +50.00 charge referencing wb1 (→ trust_wmb anchor)
  ar2: 99900602, // -25.00 allocation referencing payment (→ ledger_payment)
  // T-policies smoke (§P4 N27 alias table + 2026-08-11 rulings)
  policyDef: 99900701,         // sirius_json_definition node: title "UNITE HERE Plan"
  electionWithPolicy: 99900702,// election referencing policyDef via field_sirius_trust_policy
  deletedPolicyNid: 99900703,  // policy nid with NO staged row (deleted S1 node) → Inactive fallback
  electionDeletedPolicy: 99900704, // election referencing deletedPolicyNid
  shopDeletedPolicy: 99900705, // grievance_shop whose ledger.policy.ebh references deletedPolicyNid (5b)
};
const EPOCH_2024_04_15 = Date.UTC(2024, 3, 15) / 1000; // node.changed for end-dating
const EPOCH_AR_TS = Date.UTC(2024, 5, 1, 12) / 1000; // 2024-06-01T12:00Z → LA 2024-06-01

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(script: string, args: string[]): { status: number; report: Record<string, any> } {
  const res = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = res.stdout ?? "";
  const idx = out.indexOf("\n{");
  let report: Record<string, any> = {};
  if (idx >= 0) {
    try {
      report = JSON.parse(out.slice(idx + 1));
    } catch {
      /* report stays empty; caller's asserts will fail loudly */
    }
  }
  return { status: res.status ?? -1, report };
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

async function main() {
  await ensureStagingSchema();
  await ensureRawLedgerTable();
  await ensureIdMap();

  // ---- gather real dev entities -------------------------------------------
  const workerMaps = await rows<{ s1_id: string; s2_id: string }>(
    sql`SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m JOIN workers w ON w.id = m.s2_id
        WHERE m.entity = 'worker' ORDER BY m.s1_id LIMIT 2`,
  );
  const employerMaps = await rows<{ s1_id: string; s2_id: string }>(
    sql`SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m JOIN employers e ON e.id = m.s2_id
        WHERE m.entity = 'employer' ORDER BY m.s1_id LIMIT 1`,
  );
  const benefits = await rows<{ id: string }>(sql`SELECT id FROM trust_benefits ORDER BY id LIMIT 2`);
  const relType = await rows<{ id: string }>(sql`SELECT id FROM options_worker_relation_type ORDER BY name LIMIT 1`);
  const acctNids = await rows<{ nid: string }>(
    sql`SELECT nid FROM s1_staging.records WHERE bundle = 'sirius_ledger_account' ORDER BY nid LIMIT 1`,
  );
  const checkOpt = await rows<{ id: string }>(sql`SELECT id FROM options_ledger_payment_type WHERE name = 'Check'`);
  const checkTerm = await getMappings("term", [1504]);
  if (
    workerMaps.length < 2 || employerMaps.length < 1 || benefits.length < 2 ||
    relType.length < 1 || acctNids.length < 1 || checkOpt.length < 1
  ) {
    console.error("SETUP FAIL: dev DB is missing prerequisite rows (workers/employers/benefits/reltype/accounts/Check option).");
    process.exit(1);
  }
  if (checkTerm.get(1504)?.s2Id !== checkOpt[0].id) {
    console.error("SETUP FAIL: id_map term 1504 does not map to the 'Check' payment-type option — run T4 first.");
    process.exit(1);
  }
  const w1Nid = Number(workerMaps[0].s1_id), w1 = workerMaps[0].s2_id;
  const w2Nid = Number(workerMaps[1].s1_id), w2 = workerMaps[1].s2_id;
  const e1Nid = Number(employerMaps[0].s1_id), e1 = employerMaps[0].s2_id;
  const [b1, b2] = [benefits[0].id, benefits[1].id];
  const acctNid = Number(acctNids[0].nid);

  let relId: string | null = null;
  let tmpEmployerId: string | null = null;

  try {
    // ---- seed: relation row (loader reads worker_1/worker_2) ---------------
    const relRes = await rows<{ id: string }>(sql`
      INSERT INTO worker_relations (worker_1, worker_2, relation_type, start_ymd)
      VALUES (${w1}, ${w2}, ${relType[0].id}, '2020-01-01') RETURNING id
    `);
    relId = relRes[0].id;
    await putMapping("relation", N.relation, relId, { stub: false, loader: "smoke" });

    // ---- seed: staged fakes ------------------------------------------------
    const base = { vid: null as number | null, uid: 1, status: 1, created: EPOCH_2024_04_15, changed: EPOCH_2024_04_15 };
    await upsertRecords([
      { ...base, bundle: "sirius_trust_benefit", nid: N.benefit1, title: "Smoke Benefit One", fields: {} },
      { ...base, bundle: "sirius_trust_benefit", nid: N.benefit2, title: "Smoke Benefit Two", fields: {} },
      {
        ...base, bundle: "sirius_trust_worker_election", nid: N.election1, title: null,
        fields: {
          field_sirius_worker: w1Nid, field_grievance_shop: e1Nid,
          field_sirius_date_start: "2024-01-01 00:00:00", field_sirius_date_end: "2024-12-31 00:00:00",
          field_sirius_trust_benefits: [N.benefit1, N.benefit2],
          field_sirius_trust_election_type: 1521, field_sirius_active: "Yes",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_election", nid: N.election2, title: null,
        fields: {
          field_sirius_worker: w1Nid, field_grievance_shop: e1Nid,
          field_sirius_date_start: "2025-01-01 00:00:00",
          field_sirius_trust_benefits: [N.benefit1],
          field_sirius_contact_relations: [N.relation], field_sirius_active: "Yes",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_election", nid: N.election3, title: null,
        fields: {
          field_sirius_worker: w1Nid, field_grievance_shop: e1Nid,
          field_sirius_date_start: "2024-01-01 00:00:00",
          field_sirius_trust_benefits: [N.benefit2], field_sirius_active: "No",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_benefit", nid: N.wb1, title: null,
        fields: {
          field_sirius_trust_benefit: N.benefit1, field_sirius_trust_subscriber: w1Nid,
          field_grievance_shop: e1Nid, field_sirius_date_start: "2024-01-15 00:00:00",
          field_sirius_date_end: "2024-03-10 00:00:00", field_sirius_active: "Yes",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_benefit", nid: N.wb2, title: null,
        fields: {
          field_sirius_trust_benefit: N.benefit1, field_sirius_trust_subscriber: w1Nid,
          field_grievance_shop: e1Nid, field_sirius_date_start: "2026-06-01 00:00:00",
          field_sirius_active: "Yes",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_benefit", nid: N.wb3, title: null,
        fields: {
          field_sirius_trust_benefit: N.benefit1, field_sirius_trust_subscriber: w1Nid,
          field_sirius_contact_relation: N.relation, field_grievance_shop: e1Nid,
          field_sirius_date_start: "2024-02-01 00:00:00", field_sirius_date_end: "2024-02-20 00:00:00",
          field_sirius_active: "Yes",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_benefit", nid: N.wb4, title: null,
        fields: {
          field_sirius_trust_benefit: N.benefit2, field_sirius_trust_subscriber: w1Nid,
          field_grievance_shop: e1Nid, field_sirius_date_start: "2024-01-01 00:00:00",
          field_sirius_active: "No",
        },
      },
      {
        ...base, bundle: "sirius_trust_worker_benefit", nid: N.wb5, title: null,
        fields: {
          field_sirius_trust_benefit: N.benefit2, field_sirius_trust_subscriber: w1Nid,
          field_sirius_trust_election: N.election1,
          field_sirius_date_start: "2024-06-01 00:00:00", field_sirius_date_end: "2024-06-15 00:00:00",
          field_sirius_active: "Yes",
        },
      },
      {
        ...base, bundle: "sirius_payment", nid: N.payment, title: null,
        fields: {
          field_sirius_payer: w1Nid, field_sirius_dollar_amt: "123.45",
          field_sirius_ledger_account: acctNid, field_sirius_payment_status: "Cleared",
          field_sirius_payment_type: 1504, field_sirius_datetime_created: "2024-05-01 10:00:00",
          field_sirius_check_number: "9001",
        },
      },
    ]);
    await putMapping("benefit", N.benefit1, b1, { stub: false, loader: "smoke" });
    await putMapping("benefit", N.benefit2, b2, { stub: false, loader: "smoke" });
    await upsertRawLedger([
      { ledgerId: N.ar1, amount: "50.00", status: "Cleared", account: acctNid, participant: w1Nid, reference: N.wb1, ts: EPOCH_AR_TS, memo: "smoke charge", key: "smoke", json: null },
      { ledgerId: N.ar2, amount: "-25.00", status: "Cleared", account: acctNid, participant: w1Nid, reference: N.payment, ts: EPOCH_AR_TS, memo: "smoke allocation", key: "smoke", json: null },
    ]);

    // ---- T16 elections ------------------------------------------------------
    console.log("T16 run 1 (create):");
    const t16 = runLoader("load-elections.ts", ["--allow-rejects", "worker_ref_missing"]);
    check("t16 exit 0", t16.status === 0, t16.status);
    check("t16 created 3", t16.report.created === 3, t16.report.created);
    check("t16 typed 1", t16.report.typedElections === 1, t16.report.typedElections);
    check("t16 untyped 2", t16.report.untypedElections === 2, t16.report.untypedElections);
    check("t16 first_time 1", t16.report.perEnrollmentType?.first_time === 1, t16.report.perEnrollmentType);
    check("t16 endDatedFromChanged 1", t16.report.endDatedFromChanged === 1, t16.report.endDatedFromChanged);
    check("t16 verify clean", t16.report.verifyFailures === 0, t16.report.verifyFailures);

    const elMap = await getMappings("election", [N.election1, N.election2, N.election3]);
    const el1 = elMap.get(N.election1)?.s2Id;
    const el2 = elMap.get(N.election2)?.s2Id;
    const el3 = elMap.get(N.election3)?.s2Id;
    check("t16 all mapped", Boolean(el1 && el2 && el3));
    if (el1 && el2 && el3) {
      const r1 = await storage.workerTrustElections.getById(el1);
      check("t16 e1 benefit order", JSON.stringify(r1?.benefitIds) === JSON.stringify([b1, b2]), r1?.benefitIds);
      check("t16 e1 enrollment first_time", r1?.enrollmentType === "first_time", r1?.enrollmentType);
      const r2 = await storage.workerTrustElections.getById(el2);
      check("t16 e2 relation resolved", JSON.stringify(r2?.relationshipIds) === JSON.stringify([relId]), r2?.relationshipIds);
      check("t16 e2 open end", r2?.endYmd == null, r2?.endYmd);
      const r3 = await storage.workerTrustElections.getById(el3);
      check("t16 e3 end-dated from changed", r3?.endYmd === "2024-04-15", r3?.endYmd);
    }

    console.log("T16 run 2 (idempotent adopt):");
    const t16b = runLoader("load-elections.ts", ["--allow-rejects", "worker_ref_missing"]);
    check("t16b exit 0", t16b.status === 0, t16b.status);
    check("t16b created 0", t16b.report.created === 0, t16b.report.created);
    check("t16b adopted 3", t16b.report.adopted === 3, t16b.report.adopted);
    check("t16b verify clean", t16b.report.verifyFailures === 0, t16b.report.verifyFailures);

    console.log("T16 run 3 (crash-repair: lost id_map row re-adopted by provenance):");
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'election' AND s1_id = ${N.election1}`);
    const t16c = runLoader("load-elections.ts", ["--allow-rejects", "worker_ref_missing"]);
    check("t16c exit 0", t16c.status === 0, t16c.status);
    check("t16c created 0 (no duplicate)", t16c.report.created === 0, t16c.report.created);
    check("t16c adopted 3", t16c.report.adopted === 3, t16c.report.adopted);
    check("t16c adoptedByProvenance 1", t16c.report.adoptedByProvenance === 1, t16c.report.adoptedByProvenance);
    check("t16c verify clean", t16c.report.verifyFailures === 0, t16c.report.verifyFailures);
    const repairedEl = await getMappings("election", [N.election1]);
    check("t16c id_map repaired to same row", repairedEl.get(N.election1)?.s2Id === el1, repairedEl.get(N.election1)?.s2Id);

    // ---- T17 benefit history ------------------------------------------------
    console.log("T17 run 1 (create):");
    const t17 = runLoader("load-benefit-history.ts", ["--open-end-through", "2026-08", "--allow-rejects", "benefit_unmapped"]);
    check("t17 exit 0", t17.status === 0, t17.status);
    check("t17 resolvedSpans 5", t17.report.resolvedSpans === 5, t17.report.resolvedSpans);
    check("t17 monthsCreated 12", t17.report.monthsCreated === 12, t17.report.monthsCreated);
    check("t17 openSpans 1", t17.report.openSpans === 1, t17.report.openSpans);
    check("t17 dependentSpans 1", t17.report.dependentSpans === 1, t17.report.dependentSpans);
    check("t17 employerFromElection 1", t17.report.employerFromElection === 1, t17.report.employerFromElection);
    check("t17 inactiveEndDated 1", t17.report.inactiveEndDated === 1, t17.report.inactiveEndDated);
    check("t17 anchorsCreated 5", t17.report.anchorsCreated === 5, t17.report.anchorsCreated);
    check("t17 verify clean", t17.report.verifyFailures === 0, t17.report.verifyFailures);

    const depRows = await rows<{ source_relation_id: string | null; employer_id: string; month: number; year: number }>(
      sql`SELECT source_relation_id, employer_id, month, year FROM trust_wmb WHERE worker_id = ${w2}`,
    );
    check("t17 dependent row exists once", depRows.length === 1, depRows.length);
    check("t17 dependent carries relation", depRows[0]?.source_relation_id === relId, depRows[0]);
    const w5Rows = await rows<{ employer_id: string }>(
      sql`SELECT employer_id FROM trust_wmb WHERE worker_id = ${w1} AND benefit_id = ${b2} AND year = 2024 AND month = 6`,
    );
    check("t17 wb5 employer from election", w5Rows[0]?.employer_id === e1, w5Rows[0]);

    console.log("T17 run 2 (idempotent adopt):");
    const t17b = runLoader("load-benefit-history.ts", ["--open-end-through", "2026-08", "--allow-rejects", "benefit_unmapped"]);
    check("t17b exit 0", t17b.status === 0, t17b.status);
    check("t17b monthsCreated 0", t17b.report.monthsCreated === 0, t17b.report.monthsCreated);
    check("t17b monthsAdopted 12", t17b.report.monthsAdopted === 12, t17b.report.monthsAdopted);
    check("t17b anchorsAdopted 5", t17b.report.anchorsAdopted === 5, t17b.report.anchorsAdopted);
    check("t17b verify clean", t17b.report.verifyFailures === 0, t17b.report.verifyFailures);

    // ---- T19 payments ---------------------------------------------------------
    console.log("T19 run 1 (typed create):");
    const t19 = runLoader("load-payments.ts", ["--allow-rejects", "payment_type_missing"]);
    check("t19 exit 0", t19.status === 0, t19.status);
    check("t19 created 1", t19.report.created === 1, t19.report.created);
    check("t19 typeless real rows rejected", t19.report.rejects?.payment_type_missing === 30, t19.report.rejects);
    check("t19 verify clean", t19.report.verifyFailures === 0, t19.report.verifyFailures);

    const payMap = await getMappings("payment", [N.payment]);
    const payId = payMap.get(N.payment)?.s2Id;
    check("t19 mapped", Boolean(payId));
    if (payId) {
      const [p] = await storage.ledger.payments.getByIds([payId]);
      check("t19 amount", Number(p?.amount) === 123.45, p?.amount);
      check("t19 status cleared", p?.status === "cleared", p?.status);
      check("t19 allocated", p?.allocated === true, p?.allocated);
      check("t19 paymentType Check", p?.paymentType === checkOpt[0].id, p?.paymentType);
      check("t19 dateCreated UTC", p?.dateCreated?.toISOString() === "2024-05-01T10:00:00.000Z", p?.dateCreated);
      check("t19 dateCleared set", p?.dateCleared?.toISOString() === "2024-05-01T10:00:00.000Z", p?.dateCleared);
      const ea = await rows<{ entity_type: string; entity_id: string }>(
        sql`SELECT ea.entity_type, ea.entity_id FROM ledger_ea ea JOIN ledger_payments p ON p.ledger_ea_id = ea.id WHERE p.id = ${payId}`,
      );
      check("t19 EA is worker w1", ea[0]?.entity_type === "worker" && ea[0]?.entity_id === w1, ea[0]);
    }

    console.log("T19 run 2 (idempotent adopt):");
    const t19b = runLoader("load-payments.ts", ["--allow-rejects", "payment_type_missing"]);
    check("t19b exit 0", t19b.status === 0, t19b.status);
    check("t19b created 0", t19b.report.created === 0, t19b.report.created);
    check("t19b adopted 1", t19b.report.adopted === 1, t19b.report.adopted);
    check("t19b verify clean", t19b.report.verifyFailures === 0, t19b.report.verifyFailures);

    console.log("T19 run 3 (crash-repair: lost id_map row re-adopted by provenance):");
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'payment' AND s1_id = ${N.payment}`);
    const t19c = runLoader("load-payments.ts", ["--allow-rejects", "payment_type_missing"]);
    check("t19c exit 0", t19c.status === 0, t19c.status);
    check("t19c created 0 (no duplicate)", t19c.report.created === 0, t19c.report.created);
    check("t19c adopted 1", t19c.report.adopted === 1, t19c.report.adopted);
    check("t19c adoptedByProvenance 1", t19c.report.adoptedByProvenance === 1, t19c.report.adoptedByProvenance);
    check("t19c verify clean", t19c.report.verifyFailures === 0, t19c.report.verifyFailures);
    const repairedPay = await getMappings("payment", [N.payment]);
    check("t19c id_map repaired to same row", repairedPay.get(N.payment)?.s2Id === payId, repairedPay.get(N.payment)?.s2Id);

    // ---- T18 ledger charges ---------------------------------------------------
    console.log("T18 run 1 (fakes create, real rows adopt):");
    const t18 = runLoader("load-ledger.ts", ["--allow-rejects", "non_cleared_status"]);
    check("t18 exit 0", t18.status === 0, t18.status);
    check("t18 created 2", t18.report.created === 2, t18.report.created);
    check("t18 adopted 50", t18.report.adopted === 50, t18.report.adopted);
    check("t18 wb reference resolved", t18.report.referenceTypes?.trust_wmb === 1, t18.report.referenceTypes);
    check("t18 payment references", t18.report.referenceTypes?.ledger_payment === 51, t18.report.referenceTypes);
    check("t18 verify clean", t18.report.verifyFailures === 0, t18.report.verifyFailures);
    check("t18 per-account parity", Array.isArray(t18.report.perAccount) && t18.report.perAccount.every((a: any) => a.ok), t18.report.perAccount);

    const wbMap = await getMappings("wb", [N.wb1]);
    const anchor = wbMap.get(N.wb1)?.s2Id;
    const e1row = await rows<{ amount: string; reference_type: string | null; reference_id: string | null; statement_ymd: string }>(
      sql`SELECT amount, reference_type, reference_id, statement_ymd::text AS statement_ymd FROM ledger
           WHERE charge_plugin = 's1-import' AND charge_plugin_key = ${"ar-" + N.ar1}`,
    );
    check("t18 charge amount verbatim", Number(e1row[0]?.amount) === 50.0, e1row[0]?.amount);
    check("t18 charge references wmb anchor", e1row[0]?.reference_type === "wmb" && e1row[0]?.reference_id === anchor, e1row[0]);
    check("t18 statement first-of-month (LA)", e1row[0]?.statement_ymd === "2024-06-01", e1row[0]?.statement_ymd);
    const e2row = await rows<{ amount: string; reference_type: string | null }>(
      sql`SELECT amount, reference_type FROM ledger WHERE charge_plugin = 's1-import' AND charge_plugin_key = ${"ar-" + N.ar2}`,
    );
    check("t18 negative allocation verbatim", Number(e2row[0]?.amount) === -25.0, e2row[0]?.amount);
    check("t18 allocation references payment", e2row[0]?.reference_type === "payment", e2row[0]);

    console.log("T18 run 2 (idempotent adopt):");
    const t18b = runLoader("load-ledger.ts", ["--allow-rejects", "non_cleared_status"]);
    check("t18b exit 0", t18b.status === 0, t18b.status);
    check("t18b created 0", t18b.report.created === 0, t18b.report.created);
    check("t18b adopted 52", t18b.report.adopted === 52, t18b.report.adopted);
    check("t18b verify clean", t18b.report.verifyFailures === 0, t18b.report.verifyFailures);

    // ---- Seeder: R→UH rename ruling (2026-08-11) ----------------------------
    // Converge the catalogue first (renames a legacy R row in place if the
    // dev DB still carries one), then exercise the rename path and the
    // both-rows-present abort deterministically.
    console.log("Seeder run (converge catalogue; legacy R renames in place):");
    const seed1 = runLoader("seed-migration-policies.ts", []);
    check("seed1 exit 0", seed1.status === 0, seed1.status);
    const uhRows = await rows<{ id: string; name: string | null }>(sql`SELECT id, name FROM policies WHERE sirius_id = 'UH'`);
    const rRows = await rows<{ id: string }>(sql`SELECT id FROM policies WHERE sirius_id = 'R'`);
    check("seeder UH exists", uhRows.length === 1, uhRows.length);
    check("seeder UH named Unite Here Plan", uhRows[0]?.name === "Unite Here Plan", uhRows[0]?.name);
    check("seeder R gone", rRows.length === 0, rRows.length);
    const uhId = uhRows[0]?.id;

    console.log("Seeder rename path (flip UH back to R, re-run — same row UUID):");
    await db.execute(sql`UPDATE policies SET sirius_id = 'R', name = 'Restaurant Plan' WHERE id = ${uhId}`);
    const seed2 = runLoader("seed-migration-policies.ts", []);
    check("seed2 exit 0", seed2.status === 0, seed2.status);
    check("seed2 renamedFromR 1", seed2.report.renamedFromR === 1, seed2.report.renamedFromR);
    check("seed2 created 0", seed2.report.created === 0, seed2.report.created);
    const uhAfter = await rows<{ id: string; name: string | null }>(sql`SELECT id, name FROM policies WHERE sirius_id = 'UH'`);
    check("seed2 UH same row UUID", uhAfter[0]?.id === uhId, uhAfter[0]?.id);
    check("seed2 UH renamed to Unite Here Plan", uhAfter[0]?.name === "Unite Here Plan", uhAfter[0]?.name);

    console.log("Seeder abort path (BOTH R and UH present):");
    const fakeR = await rows<{ id: string }>(
      sql`INSERT INTO policies (sirius_id, name) VALUES ('R', 'Restaurant Plan') RETURNING id`,
    );
    const seed3 = runLoader("seed-migration-policies.ts", []);
    check("seed3 aborts (exit 1)", seed3.status === 1, seed3.status);
    const uhUntouched = await rows<{ id: string; name: string | null }>(sql`SELECT id, name FROM policies WHERE sirius_id = 'UH'`);
    check("seed3 UH row untouched", uhUntouched[0]?.id === uhId && uhUntouched[0]?.name === "Unite Here Plan", uhUntouched[0]);
    await db.execute(sql`DELETE FROM policies WHERE id = ${fakeR[0].id}`);

    // ---- T-policies (N27 alias table + Inactive fallback) -------------------
    // Seed one sirius_json_definition node + one election referencing it
    // (title "UNITE HERE Plan" must resolve via the alias table to S2
    // siriusId=UH), plus one election referencing a nid with NO staged row
    // (deleted S1 node) — that ref must map to the Inactive policy (U) and
    // surface in the per-nid mappedToInactive report (ruling 2026-08-11).
    console.log("T-policies run 1 (alias-table match + Inactive fallback + idmap write):");
    const policyBase = { vid: null as number | null, uid: 1, status: 1, created: EPOCH_2024_04_15, changed: EPOCH_2024_04_15 };
    await upsertRecords([
      {
        ...policyBase,
        bundle: "sirius_json_definition",
        nid: N.policyDef,
        title: "UNITE HERE Plan",
        fields: {},
      },
      {
        ...policyBase,
        bundle: "sirius_trust_worker_election",
        nid: N.electionWithPolicy,
        title: null,
        // field_sirius_trust_policy = reference to policyDef
        fields: { field_sirius_trust_policy: N.policyDef },
      },
      {
        ...policyBase,
        bundle: "sirius_trust_worker_election",
        nid: N.electionDeletedPolicy,
        title: null,
        // reference to a nid that is NOT staged (deleted S1 node)
        fields: { field_sirius_trust_policy: N.deletedPolicyNid },
      },
    ]);
    // Dev staging carries the non-policy "workers_v1" sirius_json_definition
    // node → allow policy_unmatched_unreferenced (documented dev allowance).
    const tPol1 = runLoader("load-policies.ts", ["--allow-rejects", "policy_unmatched_unreferenced"]);
    check("tPol1 exit 0", tPol1.status === 0, tPol1.status);
    check("tPol1 distinctPolicyRefs ≥ 2", (tPol1.report.distinctPolicyRefs as number) >= 2, tPol1.report.distinctPolicyRefs);
    check("tPol1 mappingsWritten ≥ 2", (tPol1.report.mappingsWritten as number) >= 2, tPol1.report.mappingsWritten);
    check("tPol1 verify clean", tPol1.report.verifyFailures === 0, tPol1.report.verifyFailures);
    // Confirm id_map entry points at S2 policy with siriusId=UH
    const policyMaps = await getMappings("policy", [N.policyDef]);
    const mappedPolicyId = policyMaps.get(N.policyDef)?.s2Id;
    const policyRow = mappedPolicyId ? await storage.policies.getPolicyById(mappedPolicyId) : null;
    check("tPol1 alias UNITE HERE Plan → UH", policyRow?.siriusId === "UH", policyRow?.siriusId);
    // Inactive fallback: per-nid election counts, retired reject class,
    // non-stub id_map entry pointing at the U policy.
    check(
      "tPol1 mappedToInactive per-nid count",
      tPol1.report.mappedToInactive?.[String(N.deletedPolicyNid)] === 1,
      tPol1.report.mappedToInactive,
    );
    check(
      "tPol1 no policy_ref_not_staged reject (retired)",
      tPol1.report.rejects?.policy_ref_not_staged === undefined,
      tPol1.report.rejects,
    );
    const inactiveMaps = await getMappings("policy", [N.deletedPolicyNid]);
    const inactiveEntry = inactiveMaps.get(N.deletedPolicyNid);
    const inactiveRow = inactiveEntry ? await storage.policies.getPolicyById(inactiveEntry.s2Id) : null;
    check("tPol1 deleted nid → Inactive (U)", inactiveRow?.siriusId === "U", inactiveRow?.siriusId);
    check("tPol1 Inactive mapping non-stub", inactiveEntry?.stub === false, inactiveEntry);

    console.log("T-policies run 2 (idempotent — zero writes):");
    const tPol2 = runLoader("load-policies.ts", ["--allow-rejects", "policy_unmatched_unreferenced"]);
    check("tPol2 exit 0", tPol2.status === 0, tPol2.status);
    check("tPol2 mappingsWritten 0", tPol2.report.mappingsWritten === 0, tPol2.report.mappingsWritten);
    check("tPol2 matchedIdMap ≥ 2", (tPol2.report.matchedIdMap as number) >= 2, tPol2.report.matchedIdMap);
    check("tPol2 verify clean", tPol2.report.verifyFailures === 0, tPol2.report.verifyFailures);
    check(
      "tPol2 mappedToInactive still reported",
      tPol2.report.mappedToInactive?.[String(N.deletedPolicyNid)] === 1,
      tPol2.report.mappedToInactive,
    );

    // ---- 5b: load-employer-policies resolves deleted-nid ebh refs ----------
    // A shop whose ledger.policy.ebh references the SAME deleted nid must now
    // resolve through the Inactive id_map entry with NO code change (formerly
    // a policy_unmapped reject) — the shop gains Inactive policy history.
    console.log("T-employer-policies (deleted-nid ebh ref resolves via Inactive mapping):");
    const tmpEmp = await rows<{ id: string }>(
      sql`INSERT INTO employers (name, sirius_id) VALUES ('Smoke 5b Employer', ${"smoke-" + N.shopDeletedPolicy}) RETURNING id`,
    );
    tmpEmployerId = tmpEmp[0].id;
    await putMapping("employer", N.shopDeletedPolicy, tmpEmployerId, { stub: false, loader: "smoke" });
    await upsertRecords([
      {
        ...policyBase,
        bundle: "grievance_shop",
        nid: N.shopDeletedPolicy,
        title: "Smoke 5b Shop",
        fields: {
          field_sirius_json: JSON.stringify({
            ledger: { policy: { ebh: [{ policy: String(N.deletedPolicyNid), date: "1990-01-01" }], nid: String(N.deletedPolicyNid) } },
          }),
        },
      },
    ]);
    const tEmpPol = runLoader("load-employer-policies.ts", []);
    check("tEmpPol exit 0", tEmpPol.status === 0, tEmpPol.status);
    check("tEmpPol no policy_unmapped reject", (tEmpPol.report.rejects?.policy_unmapped ?? 0) === 0, tEmpPol.report.rejects);
    check("tEmpPol historyCreated 1", tEmpPol.report.historyCreated === 1, tEmpPol.report.historyCreated);
    check("tEmpPol verify clean", tEmpPol.report.verifyFailures === 0, tEmpPol.report.verifyFailures);
    const uPolicy = await rows<{ id: string }>(sql`SELECT id FROM policies WHERE sirius_id = 'U'`);
    const hist5b = await rows<{ policy_id: string; date: string }>(
      sql`SELECT policy_id, date::text AS date FROM employer_policy_history WHERE employer_id = ${tmpEmployerId}`,
    );
    check(
      "tEmpPol shop gains Inactive policy history",
      hist5b.length === 1 && hist5b[0]?.policy_id === uPolicy[0]?.id && hist5b[0]?.date === "1990-01-01",
      hist5b,
    );
    const tmpEmpRow = await rows<{ denorm_policy_id: string | null }>(
      sql`SELECT denorm_policy_id FROM employers WHERE id = ${tmpEmployerId}`,
    );
    check("tEmpPol denorm synced to Inactive", tmpEmpRow[0]?.denorm_policy_id === uPolicy[0]?.id, tmpEmpRow[0]);
  } finally {
    // ---- cleanup (best-effort, loud on error) -------------------------------
    console.log("cleanup:");
    const steps: Array<[string, ReturnType<typeof sql>]> = [
      ["ledger fakes", sql`DELETE FROM ledger WHERE charge_plugin = 's1-import' AND charge_plugin_key IN (${"ar-" + N.ar1}, ${"ar-" + N.ar2})`],
      ["payment fakes", sql`DELETE FROM ledger_payments WHERE details->>'s1Nid' = ${String(N.payment)}`],
      ["wmb fakes", sql`DELETE FROM trust_wmb WHERE worker_id IN (${w1}, ${w2}) AND benefit_id IN (${b1}, ${b2}) AND year IN (2024, 2026)`],
      ["election fakes", sql`DELETE FROM worker_trust_elections WHERE data->>'s1Nid' IN (${String(N.election1)}, ${String(N.election2)}, ${String(N.election3)})`],
      ["orphan smoke EAs", sql`DELETE FROM ledger_ea ea WHERE ea.entity_id IN (${w1}, ${w2})
          AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.ea_id = ea.id)
          AND NOT EXISTS (SELECT 1 FROM ledger_payments p WHERE p.ledger_ea_id = ea.id)`],
      ["relation row", sql`DELETE FROM worker_relations WHERE id = ${relId}`],
      // employer_policy_history cascades on employer delete (5b fake shop)
      ["5b temp employer", sql`DELETE FROM employers WHERE sirius_id = ${"smoke-" + N.shopDeletedPolicy}`],
      ["staged fakes", sql`DELETE FROM s1_staging.records WHERE nid BETWEEN 99900000 AND 99999999`],
      ["raw ledger fakes", sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id BETWEEN 99900000 AND 99999999`],
      ["id_map fakes", sql`DELETE FROM s1_staging.id_map WHERE s1_id BETWEEN 99900000 AND 99999999`],
    ];
    for (const [name, q] of steps) {
      try {
        await db.execute(q);
        console.log(`  cleaned: ${name}`);
      } catch (e) {
        failures++;
        console.error(`  CLEANUP FAIL: ${name} — ${(e as Error).message}`);
      }
    }
  }

  await pgPool.end();
  console.log(failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures} failed checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
