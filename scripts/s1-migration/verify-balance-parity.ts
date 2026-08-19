/**
 * N6 balance-parity harness — one of the two cutover gates (fund ruling
 * 2026-08-05: cutover is judged by validation, not loading).
 *
 * READ-ONLY against S2 app tables and staged S1 data: the harness never
 * creates, repairs, or adopts anything. Its only write is the run-report row
 * appended to s1_staging.runs (loader convention) plus the idempotent
 * CREATE-IF-NOT-EXISTS staging bootstrap.
 *
 * Balance correctness requires reconciling BOTH S1 money streams together —
 * neither is complete alone:
 *
 *   AR stream:      s1_staging.raw_ledger_ar Cleared rows (~547K in prod)
 *                   ↔ S2 `ledger` entries under charge plugin 's1-import'
 *                   (chargePluginKey 'ar-<ledger_id>'). Signs migrated
 *                   verbatim: positive = charges, negative = payment
 *                   allocations/credits. A reverse pass keyset-pages the S2
 *                   s1-import set on the ledger PRIMARY KEY, so rows with a
 *                   NULL/empty/malformed key (corrupt or partial-write
 *                   states) cannot escape the scan (ar_unparsable_key).
 *   Payment stream: staged `sirius_payment` rows (3,458 in prod)
 *                   ↔ S2 `ledger_payments` with details.source =
 *                   's1-migration', matched by details.s1Nid. T19 loaded
 *                   amounts as abs() with negative sources flagged in
 *                   details.s1NegativeAmount — the comparison restores the
 *                   sign. Only CLEARED rows count toward money sums; every
 *                   staged row still gets presence/status/amount checks.
 *
 * Per ledger account (and in aggregate) the harness recomputes count +
 * cents-exact sums on both sides of each stream, reports the drift, and a
 * combined net position (AR − cleared payments) both ways.
 *
 * Report is AGGREGATE-ONLY (HIPAA): counts, cents sums per fund-level
 * account, reason codes; samples carry S1 keys (ledger_id / nid) only —
 * never names, never per-person amounts tied to identity.
 *
 * Mismatch classes (reject-style):
 *   AR:      ar_bad_amount, ar_account_ref_missing, ar_account_unmapped,
 *            ar_missing_in_s2, ar_amount_mismatch, ar_account_mismatch,
 *            ar_extra_in_s2, ar_unparsable_key
 *   Payment: payment_status_missing, payment_status_unmapped,
 *            payment_bad_amount, payment_account_ref_missing,
 *            payment_account_unmapped, payment_missing_in_s2,
 *            payment_amount_mismatch, payment_status_mismatch,
 *            payment_account_mismatch, payment_extra_in_s2,
 *            payment_provenance_missing, payment_duplicate_in_s2
 *
 * Gate (fail-loud, exit 1 on breach):
 *   - any mismatch class NOT listed in --allow-mismatches r1,r2
 *   - any per-account or aggregate |driftCents| above --tolerance-cents
 *     (default 0 — cents-exact; raising it needs fund sign-off, Laura/Sam
 *     own the N6 test design)
 * Rows in an ALLOWED class are excluded from BOTH sides' sums (they are
 * consciously accounted for elsewhere); disallowed rows stay in, so the
 * drift figures show exactly the unexplained money.
 *
 * Volume: both passes are keyset-paged (staged AR forward, S2 s1-import
 * reverse) with batched IN-queries — nothing scales with total row count in
 * memory except the per-account aggregate map (tiny).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/verify-balance-parity.ts \
 *     [--tolerance-cents 0] [--allow-mismatches r1,r2]
 */
import { writeFileSync } from "node:fs";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun, pagedRawLedger, stagedRawLedgerCount, ensureRawLedgerTable } from "./lib/staging";
import { ensureIdMap, getMappings } from "./lib/idmap";
import { RejectLog, LOADER_PAGE_SIZE, pagedStaged, stagedCountOf, chunk, strOf, targetNidOf } from "./lib/loader-utils";
import {
  AMOUNT_RE,
  toCents,
  centsToStr,
  PAYMENT_STATUS_MAP,
  intFlag,
  listFlag,
  emptyStream,
  addS1,
  addS2,
  streamReport,
  type StreamAgg,
} from "./lib/parity";

const HARNESS = "verify-balance-parity";
const CHARGE_PLUGIN = "s1-import";
const PAYMENT_BUNDLE = "sirius_payment";
const TOLERANCE_CENTS = intFlag("--tolerance-cents", 0);
const ALLOWED: string[] = listFlag("--allow-mismatches");

interface AccountAgg {
  ar: StreamAgg;
  pay: StreamAgg;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureRawLedgerTable();
  await ensureIdMap();

  const report: Record<string, unknown> = {
    harness: HARNESS,
    toleranceCents: TOLERANCE_CENTS,
    allowedMismatches: ALLOWED,
  };
  const mismatches = new RejectLog();
  const allowed = new Set(ALLOWED);

  const perAccount = new Map<string, AccountAgg>();
  const acct = (id: string): AccountAgg => {
    let a = perAccount.get(id);
    if (!a) {
      a = { ar: emptyStream(), pay: emptyStream() };
      perAccount.set(id, a);
    }
    return a;
  };
  // Rows whose S2 account cannot be resolved (disallowed mismatch classes)
  // still count toward the aggregate gate via this bucket.
  const unattributed = { ar: emptyStream(), pay: emptyStream() };

  // =========================================================================
  // AR stream — forward pass: staged Cleared rows → s1-import ledger entries
  // =========================================================================
  report.stagedAr = await stagedRawLedgerCount();
  const stagedArByStatus: Record<string, number> = {};
  let arPages = 0;

  for await (const staged of pagedRawLedger(LOADER_PAGE_SIZE)) {
    arPages++;
    for (const r of staged) {
      const st = (r.status ?? "NULL").trim();
      stagedArByStatus[st] = (stagedArByStatus[st] ?? 0) + 1;
    }
    const cleared = staged.filter((r) => (r.status ?? "").trim().toLowerCase() === "cleared");
    if (cleared.length === 0) continue;

    const accountMap = await getMappings(
      "ledger-account",
      cleared.map((r) => r.account).filter((n): n is number => n != null),
    );

    // batched existence + amount + account fetch for the page's keys
    const existing = new Map<string, { cents: number | null; accountId: string }>();
    for (const batch of chunk(cleared, 500)) {
      const keys = batch.map((r) => `ar-${r.ledgerId}`);
      const res = (await db.execute(sql`
        SELECT l.charge_plugin_key AS k, l.amount::text AS amount, ea.account_id AS account_id
          FROM ledger l JOIN ledger_ea ea ON ea.id = l.ea_id
         WHERE l.charge_plugin = ${CHARGE_PLUGIN}
           AND l.charge_plugin_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
      `)) as unknown as { rows: Array<{ k: string; amount: string; account_id: string }> };
      for (const row of res.rows) existing.set(row.k, { cents: toCents(row.amount), accountId: row.account_id });
    }

    for (const r of cleared) {
      const id = r.ledgerId;
      const amountOk = r.amount != null && AMOUNT_RE.test(r.amount.trim());
      const cents = amountOk ? toCents(r.amount!.trim()) : null;
      if (cents == null) {
        mismatches.add("ar_bad_amount", { ledgerId: id }, id);
        continue; // no exact cents to attribute — count-only
      }
      let accountId: string | null = null;
      if (r.account == null) {
        mismatches.add("ar_account_ref_missing", { ledgerId: id }, id);
        if (!allowed.has("ar_account_ref_missing")) addS1(unattributed.ar, cents);
        continue;
      }
      accountId = accountMap.get(r.account)?.s2Id ?? null;
      if (!accountId) {
        mismatches.add("ar_account_unmapped", { ledgerId: id, accountNid: r.account }, id);
        if (!allowed.has("ar_account_unmapped")) addS1(unattributed.ar, cents);
        continue;
      }

      const got = existing.get(`ar-${id}`);
      if (!got) {
        mismatches.add("ar_missing_in_s2", { ledgerId: id }, id);
        if (!allowed.has("ar_missing_in_s2")) addS1(acct(accountId).ar, cents);
        continue;
      }
      const reasons: string[] = [];
      if (got.cents == null || got.cents !== cents) reasons.push("ar_amount_mismatch");
      if (got.accountId !== accountId) reasons.push("ar_account_mismatch");
      if (reasons.length === 0) {
        addS1(acct(accountId).ar, cents);
        addS2(acct(accountId).ar, got.cents!);
        continue;
      }
      for (const reason of reasons) mismatches.add(reason, { ledgerId: id }, id);
      // excluded from sums only when EVERY reason on the row is allowed
      if (!reasons.every((x) => allowed.has(x))) {
        addS1(acct(accountId).ar, cents);
        if (got.cents != null) addS2(acct(got.accountId).ar, got.cents);
      }
    }
  }
  report.arPages = arPages;
  report.stagedArByStatus = stagedArByStatus;

  // =========================================================================
  // AR stream — reverse pass: s1-import entries with no staged Cleared source.
  // Keyset-paged on the ledger PRIMARY KEY (non-null, unique) — paging on
  // charge_plugin_key would silently skip rows whose key is NULL or ''
  // (SQL NULL comparisons / `> ''` both exclude them), and exactly those
  // corrupt/partial-write rows are what this gate must catch.
  // =========================================================================
  let s2ArEntries = 0;
  {
    let lastId = "";
    for (;;) {
      const res = (await db.execute(sql`
        SELECT l.id AS row_id, l.charge_plugin_key AS k, l.amount::text AS amount, ea.account_id AS account_id
          FROM ledger l JOIN ledger_ea ea ON ea.id = l.ea_id
         WHERE l.charge_plugin = ${CHARGE_PLUGIN} AND l.id > ${lastId}
         ORDER BY l.id LIMIT ${LOADER_PAGE_SIZE}
      `)) as unknown as { rows: Array<{ row_id: string; k: string | null; amount: string; account_id: string }> };
      const rows = res.rows;
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].row_id;
      s2ArEntries += rows.length;

      const parsed: Array<{ k: string; ledgerId: number; cents: number | null; accountId: string }> = [];
      for (const row of rows) {
        const m = row.k == null ? null : row.k.match(/^ar-(\d+)$/);
        if (!m) {
          mismatches.add("ar_unparsable_key", { key: row.k, rowId: row.row_id });
          if (!allowed.has("ar_unparsable_key")) {
            const c = toCents(row.amount);
            if (c != null) addS2(acct(row.account_id).ar, c);
          }
          continue;
        }
        parsed.push({ k: row.k!, ledgerId: Number(m[1]), cents: toCents(row.amount), accountId: row.account_id });
      }

      const stagedCleared = new Set<number>();
      for (const batch of chunk(parsed, 500)) {
        const r2 = (await db.execute(sql`
          SELECT ledger_id FROM s1_staging.raw_ledger_ar
           WHERE lower(trim(coalesce(ledger_status, ''))) = 'cleared'
             AND ledger_id IN (${sql.join(batch.map((p) => sql`${p.ledgerId}`), sql`, `)})
        `)) as unknown as { rows: Array<{ ledger_id: string | number }> };
        for (const row of r2.rows) stagedCleared.add(Number(row.ledger_id));
      }
      for (const p of parsed) {
        if (stagedCleared.has(p.ledgerId)) continue; // compared in the forward pass
        mismatches.add("ar_extra_in_s2", { ledgerId: p.ledgerId }, p.ledgerId);
        if (!allowed.has("ar_extra_in_s2") && p.cents != null) addS2(acct(p.accountId).ar, p.cents);
      }
      if (rows.length < LOADER_PAGE_SIZE) break;
    }
  }
  report.s2ArEntries = s2ArEntries;

  // =========================================================================
  // Payment stream — staged sirius_payment ↔ loaded s1-migration payments
  // =========================================================================
  report.stagedPayments = await stagedCountOf(PAYMENT_BUNDLE);

  // Loaded side (prod: 3,458 rows — a single scan is fine).
  const loadedRows = (
    (await db.execute(sql`
      SELECT p.id, p.amount::text AS amount, p.status, ea.account_id AS account_id,
             p.details->>'s1Nid' AS s1nid, p.details->>'s1NegativeAmount' AS neg
        FROM ledger_payments p JOIN ledger_ea ea ON ea.id = p.ledger_ea_id
       WHERE p.details->>'source' = 's1-migration'
    `)) as unknown as {
      rows: Array<{ id: string; amount: string; status: string; account_id: string; s1nid: string | null; neg: string | null }>;
    }
  ).rows;
  report.loadedPayments = loadedRows.length;
  const loadedByStatus: Record<string, number> = {};
  for (const r of loadedRows) loadedByStatus[r.status] = (loadedByStatus[r.status] ?? 0) + 1;
  report.loadedPaymentsByStatus = loadedByStatus;

  const loadedByNid = new Map<number, (typeof loadedRows)[number]>();
  for (const r of loadedRows) {
    if (r.s1nid == null || !/^\d+$/.test(r.s1nid)) {
      mismatches.add("payment_provenance_missing", { paymentId: r.id });
      if (!allowed.has("payment_provenance_missing") && r.status === "cleared") {
        const c = toCents(r.amount);
        if (c != null) addS2(acct(r.account_id).pay, r.neg === "true" ? -c : c);
      }
      continue;
    }
    const nid = Number(r.s1nid);
    if (loadedByNid.has(nid)) {
      mismatches.add("payment_duplicate_in_s2", { nid, paymentId: r.id }, nid);
      if (!allowed.has("payment_duplicate_in_s2") && r.status === "cleared") {
        const c = toCents(r.amount);
        if (c != null) addS2(acct(r.account_id).pay, r.neg === "true" ? -c : c);
      }
      continue;
    }
    loadedByNid.set(nid, r);
  }

  const stagedPaymentsByStatus: Record<string, number> = {};
  const seenNids = new Set<number>();
  let payMatched = 0;

  for await (const staged of pagedStaged(PAYMENT_BUNDLE)) {
    const accountMap = await getMappings(
      "ledger-account",
      staged.map((s) => targetNidOf(s.fields, "field_sirius_ledger_account")).filter((n): n is number => n != null),
    );
    for (const s of staged) {
      const nid = s.nid;
      seenNids.add(nid);

      const statusRaw = strOf(s.fields, "field_sirius_payment_status");
      stagedPaymentsByStatus[statusRaw ?? "NULL"] = (stagedPaymentsByStatus[statusRaw ?? "NULL"] ?? 0) + 1;
      if (!statusRaw) {
        mismatches.add("payment_status_missing", { nid }, nid);
        continue;
      }
      const mapped = PAYMENT_STATUS_MAP[statusRaw.trim().toLowerCase()];
      if (!mapped) {
        mismatches.add("payment_status_unmapped", { nid, status: statusRaw }, nid);
        continue;
      }
      const amtRaw = strOf(s.fields, "field_sirius_dollar_amt");
      const signedCents = amtRaw != null && AMOUNT_RE.test(amtRaw.trim()) ? toCents(amtRaw.trim()) : null;
      if (signedCents == null) {
        mismatches.add("payment_bad_amount", { nid }, nid);
        continue;
      }
      const accountNid = targetNidOf(s.fields, "field_sirius_ledger_account");
      if (accountNid == null) {
        mismatches.add("payment_account_ref_missing", { nid }, nid);
        if (!allowed.has("payment_account_ref_missing") && mapped.status === "cleared") addS1(unattributed.pay, signedCents);
        continue;
      }
      const accountId = accountMap.get(accountNid)?.s2Id ?? null;
      if (!accountId) {
        mismatches.add("payment_account_unmapped", { nid, accountNid }, nid);
        if (!allowed.has("payment_account_unmapped") && mapped.status === "cleared") addS1(unattributed.pay, signedCents);
        continue;
      }

      const got = loadedByNid.get(nid);
      if (!got) {
        mismatches.add("payment_missing_in_s2", { nid }, nid);
        if (!allowed.has("payment_missing_in_s2") && mapped.status === "cleared") addS1(acct(accountId).pay, signedCents);
        continue;
      }
      const gotCentsAbs = toCents(got.amount);
      const gotEffective = gotCentsAbs == null ? null : got.neg === "true" ? -gotCentsAbs : gotCentsAbs;
      const reasons: string[] = [];
      if (gotEffective == null || gotEffective !== signedCents) reasons.push("payment_amount_mismatch");
      if (got.status !== mapped.status) reasons.push("payment_status_mismatch");
      if (got.account_id !== accountId) reasons.push("payment_account_mismatch");
      if (reasons.length === 0) {
        payMatched++;
        if (mapped.status === "cleared") {
          addS1(acct(accountId).pay, signedCents);
          addS2(acct(accountId).pay, gotEffective!);
        }
        continue;
      }
      for (const reason of reasons) mismatches.add(reason, { nid }, nid);
      if (!reasons.every((x) => allowed.has(x))) {
        // cleared-only money: each side contributes iff cleared on that side
        if (mapped.status === "cleared") addS1(acct(accountId).pay, signedCents);
        if (got.status === "cleared" && gotEffective != null) addS2(acct(got.account_id).pay, gotEffective);
      }
    }
  }
  report.stagedPaymentsByStatus = stagedPaymentsByStatus;
  report.paymentsMatched = payMatched;

  // extras: loaded s1-migration payments whose s1Nid is not staged
  for (const [nid, r] of loadedByNid) {
    if (seenNids.has(nid)) continue;
    mismatches.add("payment_extra_in_s2", { nid, paymentId: r.id }, nid);
    if (!allowed.has("payment_extra_in_s2") && r.status === "cleared") {
      const c = toCents(r.amount);
      if (c != null) addS2(acct(r.account_id).pay, r.neg === "true" ? -c : c);
    }
  }

  // =========================================================================
  // Gate + report
  // =========================================================================
  const accountNames = new Map<string, string>(
    (
      (await db.execute(sql`SELECT id, name FROM ledger_accounts`)) as unknown as {
        rows: Array<{ id: string; name: string }>;
      }
    ).rows.map((r) => [r.id, r.name]),
  );

  const failures: string[] = [];
  const aggregate: AccountAgg = { ar: emptyStream(), pay: emptyStream() };
  const perAccountReport: Array<Record<string, unknown>> = [];

  const checkDrift = (scope: string, agg: AccountAgg) => {
    const arDrift = agg.ar.s2Cents - agg.ar.s1Cents;
    const payDrift = agg.pay.s2Cents - agg.pay.s1Cents;
    const ok = Math.abs(arDrift) <= TOLERANCE_CENTS && Math.abs(payDrift) <= TOLERANCE_CENTS;
    if (!ok) {
      failures.push(
        `${scope}: drift beyond tolerance (${TOLERANCE_CENTS}c) — ar=${centsToStr(arDrift)} payments=${centsToStr(payDrift)}`,
      );
    }
    return ok;
  };

  for (const [accountId, agg] of [...perAccount.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    aggregate.ar.s1Count += agg.ar.s1Count;
    aggregate.ar.s1Cents += agg.ar.s1Cents;
    aggregate.ar.s2Count += agg.ar.s2Count;
    aggregate.ar.s2Cents += agg.ar.s2Cents;
    aggregate.pay.s1Count += agg.pay.s1Count;
    aggregate.pay.s1Cents += agg.pay.s1Cents;
    aggregate.pay.s2Count += agg.pay.s2Count;
    aggregate.pay.s2Cents += agg.pay.s2Cents;
    const ok = checkDrift(`account ${accountId}`, agg);
    perAccountReport.push({
      accountId,
      accountName: accountNames.get(accountId) ?? null,
      ar: streamReport(agg.ar),
      payments: streamReport(agg.pay),
      netS1: centsToStr(agg.ar.s1Cents - agg.pay.s1Cents),
      netS2: centsToStr(agg.ar.s2Cents - agg.pay.s2Cents),
      ok,
    });
  }
  // fold unattributed rows into the aggregate gate
  aggregate.ar.s1Count += unattributed.ar.s1Count;
  aggregate.ar.s1Cents += unattributed.ar.s1Cents;
  aggregate.pay.s1Count += unattributed.pay.s1Count;
  aggregate.pay.s1Cents += unattributed.pay.s1Cents;
  if (unattributed.ar.s1Count > 0 || unattributed.pay.s1Count > 0) {
    report.unattributed = { ar: streamReport(unattributed.ar), payments: streamReport(unattributed.pay) };
  }
  checkDrift("aggregate", aggregate);

  report.perAccount = perAccountReport;
  report.aggregate = {
    ar: streamReport(aggregate.ar),
    payments: streamReport(aggregate.pay),
    netS1: centsToStr(aggregate.ar.s1Cents - aggregate.pay.s1Cents),
    netS2: centsToStr(aggregate.ar.s2Cents - aggregate.pay.s2Cents),
  };
  report.mismatches = mismatches.counts;
  report.mismatchSamples = mismatches.samples;

  const disallowed = mismatches.disallowedReasons(ALLOWED);
  for (const d of disallowed) failures.push(`mismatch class not allowed: ${d.reason}=${d.count}`);

  report.failures = failures;
  report.result = failures.length === 0 ? "PASS" : "FAIL";

  console.log(JSON.stringify(report, null, 2));
  await recordRun(startedAt, { harness: HARNESS, toleranceCents: TOLERANCE_CENTS, allowedMismatches: ALLOWED }, report);
  // Machine-readable handoff for the sync orchestrator (§11).
  if (process.env.S1_RESULT_JSON_PATH) writeFileSync(process.env.S1_RESULT_JSON_PATH, JSON.stringify(report));
  await pgPool.end();
  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} parity failure(s) — see report.failures`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  // HIPAA: never echo raw driver/storage errors (they can embed row values).
  // S1_MIGRATION_DEBUG=1 restores full errors for local debugging.
  if (process.env.S1_MIGRATION_DEBUG === "1") console.error(err);
  else if (err instanceof Error) console.error(`FATAL ${err.constructor.name}: ${String(err.message).split("\n")[0]}`);
  else console.error("FATAL: unknown_error");
  process.exit(1);
});
