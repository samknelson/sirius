/**
 * Smoke test for migration-loader reject classes that would otherwise fail
 * silently (Task 282: the payments loader's currency_mismatch class was
 * missing from its fatal-reasons list — a rejected row could have slipped
 * past the verify pass or written a wrong-currency payment).
 *
 * DEV-ONLY (seeds and deletes staged fakes + a temp payment-type option).
 * The loaders are run FOR REAL (no --dry-run) so the assertions prove actual
 * behavior: rejected rows produce NO S2 row and NO id_map entry, the verify
 * pass still passes, and exit behavior follows --allow-rejects.
 *
 * Phases:
 * The shared dev DB may already hold staged synthetic rows with their own
 * baseline rejects (e.g. reltype_unresolved), so every assertion is DELTA
 * based: a baseline run is captured first and the seeded run must add
 * EXACTLY the one expected reject class on top of it.
 *
 *   1. payments / currency_mismatch — stage a sirius_payment whose
 *      payment-type currency (temp CAD option) differs from its resolved
 *      ledger-account currency (real USD account):
 *        - run WITHOUT --allow-rejects: exit 1, rejects == {currency_mismatch:1}
 *          exactly (proves resolution got past status/amount/date/account/
 *          payer/type and reached the currency preflight), verifyFailures 0
 *        - no ledger_payments row, no id_map `payment` entry for the nid
 *        - run WITH --allow-rejects currency_mismatch: exit 0, still no row
 *   2. relationships / bad_changed_epoch — stage a sirius_contact_relationship
 *      that resolves fully (owner+alt workers mapped, reltype mapped, valid
 *      start date) with active=No, no end date, and an out-of-range `changed`
 *      epoch, exercising the shared epochToYmd end-dating path (same helper
 *      used by load-elections / load-benefit-history / load-member-statuses):
 *        - run WITHOUT --allow-rejects: exit 1, rejects == {bad_changed_epoch:1}
 *          exactly (no crash mid-run), verifyFailures 0
 *        - no worker_relations row, no id_map `relation` entry
 *        - run WITH --allow-rejects bad_changed_epoch: exit 0, still no row
 *   3. cleanup — remove every seeded row + the temp option.
 *
 * Fake S1 nids live in 99900900–99900999 (parity smoke uses ...800–899).
 *
 * Run: npx tsx scripts/oneoffs/s1-reject-classes-smoke.ts
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, upsertRecords } from "../s1-migration/lib/staging";
import { ensureIdMap, putMapping } from "../s1-migration/lib/idmap";

const N = {
  payment: 99900901, // staged payment with CAD type on a USD account
  paymentTypeTid: 99900910, // term tid → temp CAD option
  account: 99900911, // staged ledger account → mapped to a real USD account
  payer: 99900912, // payer nid → mapped to a real worker
  workerOwner: 99900920, // staged worker node (owning side)
  workerAlt: 99900921, // staged worker node (alt side)
  contactOwner: 99900922,
  contactAlt: 99900923,
  reltypeTid: 99900924, // term tid → real relation-type option
  relationship: 99900925, // staged relationship with bad `changed` epoch
};
const NID_LO = 99900900;
const NID_HI = 99900999;
const TEMP_OPTION_NAME = "S1 Reject Smoke CAD Type (delete me)";
const EPOCH = Date.UTC(2026, 0, 15) / 1000;
const BAD_EPOCH = 9_999_999_999; // > 2100-01-01 cutoff → epochToYmd() null

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(script: string, args: string[] = []): { status: number; report: Record<string, any> } {
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

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

/** rejects must be EXACTLY baseline + {reason: 1}. */
function isBaselinePlusOne(
  rejects: Record<string, number> | undefined,
  baseline: Record<string, number>,
  reason: string,
): boolean {
  const expected: Record<string, number> = { ...baseline, [reason]: (baseline[reason] ?? 0) + 1 };
  const got = rejects ?? {};
  const keys = new Set([...Object.keys(expected), ...Object.keys(got)]);
  for (const k of keys) if ((expected[k] ?? 0) !== (got[k] ??  0)) return false;
  return true;
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  // ---- gather real dev entities --------------------------------------------
  const accounts = await rows<{ id: string; currency_code: string }>(
    sql`SELECT id, currency_code FROM ledger_accounts WHERE currency_code = 'USD' ORDER BY id LIMIT 1`,
  );
  const workers = await rows<{ id: string }>(sql`SELECT id FROM workers ORDER BY id LIMIT 2`);
  const reltypes = await rows<{ id: string }>(sql`SELECT id FROM options_worker_relation_type ORDER BY id LIMIT 1`);
  if (accounts.length < 1 || workers.length < 2 || reltypes.length < 1) {
    console.error("FATAL: dev DB lacks a USD ledger account, 2 workers, or a relation type — cannot smoke-test");
    process.exit(1);
  }
  const acctId = accounts[0].id;
  const [workerA, workerB] = workers.map((w) => w.id);
  const reltypeId = reltypes[0].id;

  try {
    // =========================================================================
    console.log("phase 1: payments loader rejects a payment-type/account currency mismatch");
    // =========================================================================
    const payBase = runLoader("load-payments.ts");
    const payBaseRejects: Record<string, number> = payBase.report.rejects ?? {};
    check("baseline payments run is verify-clean", payBase.report.verifyFailures === 0, payBase.report.verifyFailures);
    check("baseline has no currency_mismatch", (payBaseRejects.currency_mismatch ?? 0) === 0, payBaseRejects);
    console.log(`  (baseline payment rejects: ${JSON.stringify(payBaseRejects)})`);

    // Temp payment-type option in a currency no dev account uses.
    const opt = await rows<{ id: string }>(sql`
      INSERT INTO options_ledger_payment_type (name, currency_code) VALUES (${TEMP_OPTION_NAME}, 'CAD') RETURNING id
    `);
    const cadOptionId = opt[0].id;
    await putMapping("term", N.paymentTypeTid, cadOptionId, { stub: false, loader: "smoke-282" });
    await putMapping("ledger-account", N.account, acctId, { stub: false, loader: "smoke-282" });
    await putMapping("worker", N.payer, workerA, { stub: false, loader: "smoke-282" });

    const base = { vid: null as number | null, uid: 1, status: 1, created: EPOCH, changed: EPOCH };
    await upsertRecords([
      { ...base, bundle: "sirius_ledger_account", nid: N.account, title: "Smoke Reject Account", fields: {} },
      {
        ...base,
        bundle: "sirius_payment",
        nid: N.payment,
        title: "Smoke reject payment",
        fields: {
          field_sirius_payer: N.payer,
          field_sirius_dollar_amt: "12.34",
          field_sirius_ledger_account: N.account,
          field_sirius_payment_status: "Cleared",
          field_sirius_datetime_created: "2026-01-15 12:00:00",
          field_sirius_payment_type: N.paymentTypeTid,
        },
      },
    ]);

    {
      const strict = runLoader("load-payments.ts", ["--allow-rejects", Object.keys(payBaseRejects).join(",")]);
      check("strict run FAILS (exit 1) — currency_mismatch not allowed", strict.status === 1, strict.status);
      check(
        "rejects are EXACTLY baseline + currency_mismatch:1 (resolution reached the currency preflight)",
        isBaselinePlusOne(strict.report.rejects, payBaseRejects, "currency_mismatch"),
        strict.report.rejects,
      );
      check("verify pass still passes (verifyFailures 0)", strict.report.verifyFailures === 0, strict.report.verifyFailures);
      check("no payment row created", strict.report.created === payBase.report.created, strict.report.created);

      const s2Rows = await rows<{ id: string }>(
        sql`SELECT id FROM ledger_payments WHERE details->>'s1Nid' = ${String(N.payment)}`,
      );
      check("no S2 ledger_payments row for the rejected nid", s2Rows.length === 0, s2Rows);
      const mapRows = await rows<{ s2_id: string }>(
        sql`SELECT s2_id FROM s1_staging.id_map WHERE entity = 'payment' AND s1_id = ${N.payment}`,
      );
      check("no id_map `payment` entry for the rejected nid", mapRows.length === 0, mapRows);

      const allowed = runLoader("load-payments.ts", [
        "--allow-rejects",
        [...Object.keys(payBaseRejects), "currency_mismatch"].join(","),
      ]);
      check("allowed run PASSES (exit 0)", allowed.status === 0, allowed.status);
      check("allowed run still counts the reject", allowed.report.rejects?.currency_mismatch === 1, allowed.report.rejects);
      const s2After = await rows<{ id: string }>(
        sql`SELECT id FROM ledger_payments WHERE details->>'s1Nid' = ${String(N.payment)}`,
      );
      check("allowed run still writes NO wrong-currency row", s2After.length === 0, s2After);
    }

    // =========================================================================
    console.log("phase 2: relationships loader rejects a bad `changed` epoch on the end-dating path");
    // =========================================================================
    const relBase = runLoader("load-relationships.ts");
    const relBaseRejects: Record<string, number> = relBase.report.rejects ?? {};
    check("baseline relationships run is verify-clean", relBase.report.verifyFailures === 0, relBase.report.verifyFailures);
    check("baseline has no bad_changed_epoch", (relBaseRejects.bad_changed_epoch ?? 0) === 0, relBaseRejects);
    console.log(`  (baseline relationship rejects: ${JSON.stringify(relBaseRejects)})`);

    await putMapping("worker", N.workerOwner, workerA, { stub: false, loader: "smoke-282" });
    await putMapping("worker", N.workerAlt, workerB, { stub: false, loader: "smoke-282" });
    await putMapping("term", N.reltypeTid, reltypeId, { stub: false, loader: "smoke-282" });
    await upsertRecords([
      { ...base, bundle: "sirius_worker", nid: N.workerOwner, title: null, fields: { field_sirius_contact: N.contactOwner } },
      { ...base, bundle: "sirius_worker", nid: N.workerAlt, title: null, fields: { field_sirius_contact: N.contactAlt } },
      {
        ...base,
        bundle: "sirius_contact_relationship",
        nid: N.relationship,
        changed: BAD_EPOCH, // active=No + no end date → end-dates from `changed` → must reject, not crash
        title: null,
        fields: {
          field_sirius_contact: N.contactOwner,
          field_sirius_contact_alt: N.contactAlt,
          field_sirius_contact_reltype: N.reltypeTid,
          field_sirius_date_start: "2020-01-01 00:00:00",
          field_sirius_active: "No",
          // no field_sirius_date_end — forces the epochToYmd end-dating branch
        },
      },
    ]);

    {
      const strict = runLoader("load-relationships.ts", ["--allow-rejects", Object.keys(relBaseRejects).join(",")]);
      check("strict run FAILS (exit 1) — bad_changed_epoch not allowed", strict.status === 1, strict.status);
      check(
        "rejects are EXACTLY baseline + bad_changed_epoch:1 (row fully resolved before the epoch check)",
        isBaselinePlusOne(strict.report.rejects, relBaseRejects, "bad_changed_epoch"),
        strict.report.rejects,
      );
      check("no crash — loader emitted a full report", strict.report.loader === "t15-relationships", strict.report.loader);
      check("verify pass still passes (verifyFailures 0)", strict.report.verifyFailures === 0, strict.report.verifyFailures);
      check(
        "no relation created",
        strict.report.relations?.created === relBase.report.relations?.created,
        strict.report.relations,
      );
      check(
        "no shell worker created for the rejected row",
        strict.report.relations?.shellWorkersCreated === relBase.report.relations?.shellWorkersCreated,
        strict.report.relations,
      );

      const mapRows = await rows<{ s2_id: string }>(
        sql`SELECT s2_id FROM s1_staging.id_map WHERE entity = 'relation' AND s1_id = ${N.relationship}`,
      );
      check("no id_map `relation` entry for the rejected nid", mapRows.length === 0, mapRows);
      const relRows = await rows<{ id: string }>(
        sql`SELECT id FROM worker_relations WHERE worker_1 = ${workerA} AND worker_2 = ${workerB} AND relation_type = ${reltypeId} AND start_ymd = '2020-01-01'`,
      );
      check("no worker_relations row was written", relRows.length === 0, relRows);

      const allowed = runLoader("load-relationships.ts", [
        "--allow-rejects",
        [...Object.keys(relBaseRejects), "bad_changed_epoch"].join(","),
      ]);
      check("allowed run PASSES (exit 0)", allowed.status === 0, allowed.status);
      check("allowed run still counts the reject", allowed.report.rejects?.bad_changed_epoch === 1, allowed.report.rejects);
    }
  } finally {
    // =========================================================================
    console.log("phase 3: cleanup (self-cleaning proof)");
    // =========================================================================
    const cleanups: Array<[string, ReturnType<typeof sql>]> = [
      ["staged fakes", sql`DELETE FROM s1_staging.records WHERE nid BETWEEN ${NID_LO} AND ${NID_HI}`],
      ["id_map fakes", sql`DELETE FROM s1_staging.id_map WHERE s1_id BETWEEN ${NID_LO} AND ${NID_HI}`],
      [
        "any leaked payment row (defensive)",
        sql`DELETE FROM ledger_payments WHERE details->>'source' = 's1-migration' AND (details->>'s1Nid')::bigint BETWEEN ${NID_LO} AND ${NID_HI}`,
      ],
      ["temp CAD option", sql`DELETE FROM options_ledger_payment_type WHERE name = ${TEMP_OPTION_NAME}`],
    ];
    for (const [what, q] of cleanups) {
      try {
        await db.execute(q);
        console.log(`  ok: cleanup (${what})`);
      } catch (e) {
        failures++;
        console.error(`  FAIL: cleanup (${what}) — ${e instanceof Error ? e.message.split("\n")[0] : "unknown"}`);
      }
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? `FATAL ${err.constructor.name}: ${err.message.split("\n")[0]}` : "FATAL: unknown");
  try {
    await pgPool.end();
  } catch {}
  process.exit(1);
});
