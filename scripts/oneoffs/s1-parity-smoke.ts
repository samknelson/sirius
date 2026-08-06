/**
 * Smoke test for the migration parity harnesses (verify-balance-parity,
 * verify-month-parity): proves the cutover gates actually CATCH mismatches
 * (a validator that always passes is worse than none) and that allowances /
 * thresholds behave as documented.
 *
 * DEV-ONLY (seeds and deletes staged fakes + S2 rows). Flow:
 *   0. baseline — both harnesses PASS on the untouched dev DB
 *   1. balance  — seed a staged Cleared AR row (no S2 entry) and a staged
 *      Cleared payment (never loaded): harness must exit 1 with
 *      ar_missing_in_s2 / payment_missing_in_s2 and cents-exact drift on the
 *      right account; --allow-mismatches must green it; --tolerance-cents
 *      alone must NOT mask the class failures
 *   1b. bad keys — seed an s1-import ledger row with a NULL (or '') 
 *      charge_plugin_key: the PK-keyset reverse pass must flag it
 *      (ar_unparsable_key) and count its cents as S2 drift
 *   2. month    — seed four coverage spans + deliberately skewed trust_wmb
 *      rows for 2031-05 producing exactly one of each class (matched,
 *      missing_in_s2, extra_in_s2, wrong_benefit, employer_mismatch):
 *      harness must exit 1 at threshold 0 with those exact counts and
 *      disagreementPct 85.71; a threshold above it must green the run;
 *      omitting --max-disagreement-pct must fail
 *   2b. open spans — seed an open-ended span (no end date) and prove the
 *      EXACT T17 horizon semantics: no --open-end-through ⇒ unresolved
 *      open_end_through_required (fail-loud); a horizon covering the month
 *      pulls the span INTO the comparison; a horizon before the month
 *      clamps it OUT; a horizon before the span's start ⇒ unresolved
 *      open_span_after_through
 *   3. cleanup  — remove every seeded row, then both harnesses PASS again
 *      (self-cleaning proof)
 *
 * Fake S1 nids live in 99900800–99900899 (above any real/synthetic range).
 *
 * Run: npx tsx scripts/oneoffs/s1-parity-smoke.ts
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import {
  ensureStagingSchema,
  upsertRecords,
  ensureRawLedgerTable,
  upsertRawLedger,
} from "../s1-migration/lib/staging";
import { ensureIdMap, putMapping } from "../s1-migration/lib/idmap";

const N = {
  ar: 99900801, // staged Cleared AR row with no S2 entry → ar_missing_in_s2
  payment: 99900802, // staged Cleared payment never loaded → payment_missing_in_s2
  benefit1: 99900811, // fake staged benefit mapped → real b1
  benefit2: 99900812, // fake staged benefit mapped → real b2
  wbMatched: 99900813, // w1 b1 e1 — has the matching wmb row
  wbWrongBenefit: 99900814, // w2 b1 e1 — wmb says b2
  wbEmployer: 99900815, // w3 b2 e1 — wmb says e2
  wbMissing: 99900816, // w4 b2 e1 — no wmb row
  wbOpen: 99900817, // w4 b1 e1 — open span (no end date), phase 2b
};
const MONTH = "2031-05"; // obscure month: no real dev data can collide
const EPOCH = Date.UTC(2026, 0, 15) / 1000;

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runHarness(script: string, args: string[]): { status: number; report: Record<string, any> } {
  const res = spawnSync("npx", ["tsx", `scripts/s1-migration/${script}`, ...args], {
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = res.stdout ?? "";
  const idx = out.startsWith("{") ? 0 : out.indexOf("\n{") + 1;
  let report: Record<string, any> = {};
  if (idx >= 0 && out.slice(idx).startsWith("{")) {
    try {
      report = JSON.parse(out.slice(idx));
    } catch {
      /* report stays empty; caller's asserts fail loudly */
    }
  }
  return { status: res.status ?? -1, report };
}

const runBalance = (args: string[] = []) => runHarness("verify-balance-parity.ts", args);
const runMonth = (args: string[] = []) =>
  runHarness("verify-month-parity.ts", ["--month", MONTH, "--allow-unresolved", "start_missing", ...args]);

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
        WHERE m.entity = 'worker' ORDER BY m.s1_id LIMIT 4`,
  );
  const employers = await rows<{ id: string }>(sql`SELECT id FROM employers ORDER BY id LIMIT 2`);
  const benefits = await rows<{ id: string }>(sql`SELECT id FROM trust_benefits ORDER BY id LIMIT 2`);
  const acctMaps = await rows<{ s1_id: string; s2_id: string }>(
    sql`SELECT m.s1_id, m.s2_id FROM s1_staging.id_map m JOIN ledger_accounts a ON a.id = m.s2_id
        WHERE m.entity = 'ledger-account' ORDER BY m.s1_id LIMIT 1`,
  );
  if (workerMaps.length < 4 || employers.length < 2 || benefits.length < 2 || acctMaps.length < 1) {
    console.error("SETUP FAIL: dev DB is missing prerequisites (4 mapped workers / 2 employers / 2 benefits / 1 mapped ledger account).");
    process.exit(1);
  }
  const [w1Nid, w2Nid, w3Nid, w4Nid] = workerMaps.map((m) => Number(m.s1_id));
  const [w1, w2, w3] = workerMaps.map((m) => m.s2_id);
  const [e1, e2] = employers.map((r) => r.id);
  // employer nid for spans: any id_map employer nid pointing at e1
  const e1Maps = await rows<{ s1_id: string }>(
    sql`SELECT s1_id FROM s1_staging.id_map WHERE entity = 'employer' AND s2_id = ${e1} LIMIT 1`,
  );
  if (e1Maps.length < 1) {
    console.error("SETUP FAIL: first employer has no id_map entry.");
    process.exit(1);
  }
  const e1Nid = Number(e1Maps[0].s1_id);
  const [b1, b2] = [benefits[0].id, benefits[1].id];
  const acctNid = Number(acctMaps[0].s1_id);
  const acctId = acctMaps[0].s2_id;

  try {
    // =========================================================================
    console.log("phase 0: baseline (untouched dev DB)");
    // =========================================================================
    {
      const bal = runBalance();
      check("baseline balance PASS (exit 0)", bal.status === 0, bal.report.failures);
      check("baseline balance result field", bal.report.result === "PASS");
      const mon = runMonth(["--max-disagreement-pct", "0"]);
      check("baseline month PASS (exit 0)", mon.status === 0, mon.report.failures);
      const noThreshold = runHarness("verify-month-parity.ts", ["--month", MONTH]);
      check("month harness REQUIRES --max-disagreement-pct (exit != 0)", noThreshold.status !== 0);
    }

    // =========================================================================
    console.log("phase 1: balance-parity detects seeded money mismatches");
    // =========================================================================
    await upsertRawLedger([
      {
        ledgerId: N.ar,
        amount: "77.00",
        status: "Cleared",
        account: acctNid,
        participant: w1Nid,
        reference: null,
        ts: EPOCH,
        memo: null,
        key: null,
        json: null,
      },
    ]);
    await upsertRecords([
      {
        bundle: "sirius_payment",
        nid: N.payment,
        vid: null,
        uid: 1,
        status: 1,
        created: EPOCH,
        changed: EPOCH,
        title: "Smoke parity payment",
        fields: {
          field_sirius_payer: w1Nid,
          field_sirius_dollar_amt: "10.00",
          field_sirius_ledger_account: acctNid,
          field_sirius_payment_status: "Cleared",
          field_sirius_datetime_created: "2026-01-15 12:00:00",
        },
      },
    ]);

    {
      const bal = runBalance();
      check("seeded balance FAIL (exit 1)", bal.status === 1, bal.report.failures);
      check("ar_missing_in_s2 counted once", bal.report.mismatches?.ar_missing_in_s2 === 1, bal.report.mismatches);
      check("payment_missing_in_s2 counted once", bal.report.mismatches?.payment_missing_in_s2 === 1, bal.report.mismatches);
      const acctRow = (bal.report.perAccount as any[])?.find((r) => r.accountId === acctId);
      check("AR drift is cents-exact -7700 on the seeded account", acctRow?.ar?.driftCents === -7700, acctRow?.ar);
      check("payment drift is cents-exact -1000 on the seeded account", acctRow?.payments?.driftCents === -1000, acctRow?.payments);
      check("aggregate AR drift -7700", bal.report.aggregate?.ar?.driftCents === -7700, bal.report.aggregate);

      const tolOnly = runBalance(["--tolerance-cents", "10000"]);
      check("tolerance alone does NOT mask mismatch classes (exit 1)", tolOnly.status === 1, tolOnly.report.failures);

      const allowed = runBalance(["--allow-mismatches", "ar_missing_in_s2,payment_missing_in_s2"]);
      check("allowed classes green the run (exit 0)", allowed.status === 0, allowed.report.failures);
      const allowedAcct = (allowed.report.perAccount as any[])?.find((r) => r.accountId === acctId);
      check("allowed rows are excluded from sums (drift back to 0)", allowedAcct?.ar?.driftCents === 0 && allowedAcct?.payments?.driftCents === 0, allowedAcct);
    }

    // =========================================================================
    console.log("phase 1b: reverse pass catches s1-import rows with NULL/malformed keys");
    // =========================================================================
    {
      const eaRows = await rows<{ ea_id: string }>(
        sql`SELECT ea_id FROM ledger WHERE charge_plugin = 's1-import' LIMIT 1`,
      );
      check("an s1-import ledger row exists to borrow an EA from", eaRows.length === 1);
      if (eaRows.length === 1) {
        // NULL if the DB allows it (the exact corruption the gate must catch);
        // else '' — a key the old charge_plugin_key keyset would also have skipped
        let seededKey = "NULL";
        try {
          await db.execute(sql`
            INSERT INTO ledger (charge_plugin, charge_plugin_key, amount, ea_id, memo, statement_ymd)
            VALUES ('s1-import', NULL, 33.00, ${eaRows[0].ea_id}, 'parity-smoke-badkey', '2026-01-01')
          `);
        } catch {
          seededKey = "empty-string";
          await db.execute(sql`
            INSERT INTO ledger (charge_plugin, charge_plugin_key, amount, ea_id, memo, statement_ymd)
            VALUES ('s1-import', '', 33.00, ${eaRows[0].ea_id}, 'parity-smoke-badkey', '2026-01-01')
          `);
        }
        console.log(`  (seeded ${seededKey}-key s1-import row)`);
        // allow phase-1's still-seeded missing rows so ONLY the bad key gates
        const bad = runBalance(["--allow-mismatches", "ar_missing_in_s2,payment_missing_in_s2"]);
        check("bad-key s1-import row FAILS the run (exit 1)", bad.status === 1, bad.report.failures);
        check("ar_unparsable_key counted once", bad.report.mismatches?.ar_unparsable_key === 1, bad.report.mismatches);
        check("bad-key cents land in aggregate S2 drift (+3300)", bad.report.aggregate?.ar?.driftCents === 3300, bad.report.aggregate);
        await db.execute(sql`DELETE FROM ledger WHERE charge_plugin = 's1-import' AND memo = 'parity-smoke-badkey'`);
      }
    }

    // =========================================================================
    console.log("phase 2: month-parity detects one seeded mismatch of each class");
    // =========================================================================
    const base = { vid: null as number | null, uid: 1, status: 1, created: EPOCH, changed: EPOCH };
    await upsertRecords([
      { ...base, bundle: "sirius_trust_benefit", nid: N.benefit1, title: "Smoke Parity Benefit One", fields: {} },
      { ...base, bundle: "sirius_trust_benefit", nid: N.benefit2, title: "Smoke Parity Benefit Two", fields: {} },
      ...[
        { nid: N.wbMatched, workerNid: w1Nid, benefitNid: N.benefit1 },
        { nid: N.wbWrongBenefit, workerNid: w2Nid, benefitNid: N.benefit1 },
        { nid: N.wbEmployer, workerNid: w3Nid, benefitNid: N.benefit2 },
        { nid: N.wbMissing, workerNid: w4Nid, benefitNid: N.benefit2 },
      ].map((s) => ({
        ...base,
        bundle: "sirius_trust_worker_benefit",
        nid: s.nid,
        title: null,
        fields: {
          field_sirius_trust_benefit: s.benefitNid,
          field_sirius_trust_subscriber: s.workerNid,
          field_grievance_shop: e1Nid,
          field_sirius_date_start: "2031-05-01 00:00:00",
          field_sirius_date_end: "2031-05-28 00:00:00",
          field_sirius_active: "Yes",
        },
      })),
    ]);
    // map the fake staged benefits onto real S2 benefits (read-only harness
    // resolves via id_map; the smoke, unlike the harness, may write it)
    await putMapping("benefit", N.benefit1, b1, { stub: false, loader: "parity-smoke" });
    await putMapping("benefit", N.benefit2, b2, { stub: false, loader: "parity-smoke" });
    // skewed S2 rows for 2031-05
    await db.execute(sql`
      INSERT INTO trust_wmb (month, year, worker_id, employer_id, benefit_id) VALUES
        (5, 2031, ${w1}, ${e1}, ${b1}),  -- matches wbMatched
        (5, 2031, ${w1}, ${e1}, ${b2}),  -- no span → extra_in_s2
        (5, 2031, ${w2}, ${e1}, ${b2}),  -- span says b1 → wrong_benefit
        (5, 2031, ${w3}, ${e2}, ${b2})   -- span says e1 → employer_mismatch
    `);

    {
      const mon = runMonth(["--max-disagreement-pct", "0"]);
      check("seeded month FAIL (exit 1)", mon.status === 1, mon.report.failures);
      const src = (mon.report.sources as any[])?.[0];
      const o = src?.overall ?? {};
      check("matched=1", o.matched === 1, o);
      check("missingInS2=1", o.missingInS2 === 1, o);
      check("extraInS2=1", o.extraInS2 === 1, o);
      check("wrongBenefitPairs=1", o.wrongBenefitPairs === 1, o);
      check("employerMismatchPairs=1", o.employerMismatchPairs === 1, o);
      check("disagreementPct=85.71 (6 of 7 tuple-sides)", o.disagreementPct === 85.71, o);
      check("missing sample carries the S1 nid", src?.mismatchSamples?.missingInS2?.[0]?.s1Nid === N.wbMissing, src?.mismatchSamples);
      const perBenefit = (src?.perBenefit as any[]) ?? [];
      const pb1 = perBenefit.find((r) => r.benefitId === b1);
      check("per-benefit table: b1 expected=2 matched=1", pb1?.expected === 2 && pb1?.matched === 1, pb1);

      const lenient = runMonth(["--max-disagreement-pct", "86"]);
      check("threshold 86 greens the same data (exit 0)", lenient.status === 0, lenient.report.failures);
    }

    // =========================================================================
    console.log("phase 2b: open-ended spans follow the exact T17 horizon semantics");
    // =========================================================================
    await upsertRecords([
      {
        ...base,
        bundle: "sirius_trust_worker_benefit",
        nid: N.wbOpen,
        title: null,
        fields: {
          field_sirius_trust_benefit: N.benefit1,
          field_sirius_trust_subscriber: w4Nid,
          field_grievance_shop: e1Nid,
          field_sirius_date_start: "2031-04-01 00:00:00",
          field_sirius_active: "Yes",
          // no end date — open span
        },
      },
    ]);
    {
      const noHorizon = runMonth(["--max-disagreement-pct", "86"]);
      check("open span without --open-end-through FAILS (exit 1)", noHorizon.status === 1, noHorizon.report.failures);
      const un0 = (noHorizon.report.sources as any[])?.[0]?.unresolved ?? {};
      check("unresolved open_end_through_required=1", un0.open_end_through_required === 1, un0);

      const covering = runMonth(["--max-disagreement-pct", "0", "--open-end-through", "2031-06"]);
      check("horizon past month pulls open span into comparison (exit 1)", covering.status === 1, covering.report.failures);
      const oCov = (covering.report.sources as any[])?.[0]?.overall ?? {};
      check("open span adds a second missing tuple (missingInS2=2)", oCov.missingInS2 === 2, oCov);
      check("disagreementPct=87.5 (7 of 8 tuple-sides)", oCov.disagreementPct === 87.5, oCov);

      const clamped = runMonth(["--max-disagreement-pct", "86", "--open-end-through", "2031-04"]);
      check("horizon before month clamps open span out (exit 0)", clamped.status === 0, clamped.report.failures);
      const oCl = (clamped.report.sources as any[])?.[0]?.overall ?? {};
      check("clamped run back to missingInS2=1", oCl.missingInS2 === 1, oCl);

      const afterThrough = runMonth(["--max-disagreement-pct", "86", "--open-end-through", "2031-03"]);
      check("horizon before span start FAILS (exit 1)", afterThrough.status === 1, afterThrough.report.failures);
      const unA = (afterThrough.report.sources as any[])?.[0]?.unresolved ?? {};
      check("unresolved open_span_after_through=1", unA.open_span_after_through === 1, unA);
    }

    // =========================================================================
    console.log("phase 3: cleanup restores green (self-cleaning proof)");
    // =========================================================================
  } finally {
    for (const [what, q] of [
      ["staged fakes", sql`DELETE FROM s1_staging.records WHERE nid BETWEEN 99900800 AND 99900899`],
      ["raw ledger fakes", sql`DELETE FROM s1_staging.raw_ledger_ar WHERE ledger_id BETWEEN 99900800 AND 99900899`],
      ["bad-key ledger fake", sql`DELETE FROM ledger WHERE charge_plugin = 's1-import' AND memo = 'parity-smoke-badkey'`],
      ["id_map fakes", sql`DELETE FROM s1_staging.id_map WHERE s1_id BETWEEN 99900800 AND 99900899`],
      ["seeded wmb rows", sql`DELETE FROM trust_wmb WHERE year = 2031`],
    ] as const) {
      try {
        await db.execute(q);
      } catch (e) {
        failures++;
        console.error(`  FAIL: cleanup (${what}) — ${e instanceof Error ? e.message.split("\n")[0] : "unknown"}`);
      }
    }
  }

  {
    const bal = runBalance();
    check("post-cleanup balance PASS (exit 0)", bal.status === 0, bal.report.failures);
    const mon = runMonth(["--max-disagreement-pct", "0"]);
    check("post-cleanup month PASS (exit 0)", mon.status === 0, mon.report.failures);
  }

  await pgPool.end();
  if (failures > 0) {
    console.error(`SMOKE FAIL: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("SMOKE PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE FATAL:", err instanceof Error ? err.message.split("\n")[0] : err);
  process.exit(1);
});
