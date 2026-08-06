/**
 * T19 loader — S1 payment nodes → ledger_payments. Load-order step: after
 * T1/T3 (contacts/workers) and T7 (employers); BEFORE T18 (ledger charges)
 * so AR rows that reference payment nids resolve against id_map `payment`.
 *
 * Rules (03-transformations T19, 06 §4.18):
 *   - Source bundle `sirius_payment`. Writes go through
 *     storage.ledger.payments.create DIRECTLY — the request-flow module
 *     (PAYMENT_SAVED emit + charge-plugin replay) is bypassed on purpose:
 *     these are historical facts, and S1's allocations arrive separately as
 *     negative AR rows in T18. Payment charge plugins must never re-derive
 *     them, so cleared payments load with allocated=true.
 *   - status map (explicit, unmapped = fatal reject):
 *       Cleared  → cleared (date_cleared = date_created; S1 has no separate
 *                  cleared-date field)
 *       Canceled → canceled
 *       Failed   → error
 *       Pending  → draft
 *       Received → draft (date_received = date_created)
 *     allocated=true only for cleared (the only status allocation replay
 *     could ever touch); everything else false.
 *   - amount = abs(dollar_amt) — S2 payments are positive credits; negative
 *     S1 amounts are counted and flagged in details.s1NegativeAmount.
 *   - payment_type (NOT NULL in S2): S1 term tid → id_map `term` (T4) →
 *     options_ledger_payment_type. Type-less rows reject (payment_type_missing);
 *     there is deliberately NO fallback flag — if production turns out to hold
 *     genuinely type-less payments, that needs a conscious fund ruling, not a
 *     default. Payment-type/account currency parity is preflighted per row
 *     (currency_mismatch) because createForMigration skips the storage check.
 *   - datetime_created is the `site` convention (stored UTC) → parsed as a
 *     UTC instant into date_created.
 *   - payer nid resolves worker → shell-worker → contact → employer; the
 *     ledger_ea row is getOrCreate(entityType, entityId, account).
 *
 * Idempotency: id_map entity `payment`; mapped rows are adopted and
 * re-verified (amount/status/EA equality) — drift fails the verify pass.
 *
 * Usage: npx tsx scripts/s1-migration/load-payments.ts \
 *          [--dry-run] [--allow-rejects r1,r2]
 * Output is aggregate counts only (no PII).
 */
import { storage } from "../../server/storage/database";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, pagedStaged, stagedCountOf, chunk, strOf, tidOf, targetNidOf, toYmd } from "./lib/loader-utils";
import { buildEntityResolver, ensureLedgerAccounts } from "./lib/resolvers";
import { AMOUNT_RE, PAYMENT_STATUS_MAP as STATUS_MAP, type S2PaymentStatus } from "./lib/parity";

const LOADER = "t19-payments";
const BUNDLE = "sirius_payment";
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

/** All reasons are row-skipping (fatal for that payment). */
const FATAL_REASONS = [
  "status_missing",
  "status_unmapped",
  "amount_missing",
  "bad_amount",
  "date_missing",
  "bad_date",
  "account_ref_missing",
  "account_unensured",
  "payer_ref_missing",
  "payer_unmapped",
  "payment_type_missing",
  "payment_type_term_unmapped",
  "payment_type_option_missing",
  "payment_create_failed",
  "mapped_row_missing",
] as const;

const DT_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/;

/** "YYYY-MM-DD HH:MM[:SS]" site-convention (stored UTC) → UTC Date.
 * Strict: the date part must be a real calendar date and the time fields in
 * range — new Date() normalization (2024-02-30 → Mar 1) must not invent
 * instants for malformed source rows; they reject instead. */
function parseUtcInstant(raw: string): Date | null {
  const m = raw.trim().match(DT_RE);
  if (!m) return null;
  if (toYmd(m[1]) !== m[1]) return null;
  const t = m[2].length === 5 ? `${m[2]}:00` : m[2];
  const [hh, mi, ss] = t.split(":").map(Number);
  if (hh > 23 || mi > 59 || ss > 59) return null;
  const d = new Date(`${m[1]}T${t}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = {
    loader: LOADER,
    dryRun: DRY_RUN,
    allowedRejects: ALLOWED_REJECTS,
  };
  const rejects = new RejectLog();

  report.staged = await stagedCountOf(BUNDLE);

  // ---- accounts (T18a shared policy: id_map → adopt by name → create) ----
  const accounts = await ensureLedgerAccounts(LOADER, DRY_RUN);
  report.accounts = {
    staged: accounts.stagedAccounts,
    viaIdMap: accounts.viaIdMap,
    adoptedByName: accounts.adoptedByName,
    created: accounts.created,
    failed: accounts.failed.size,
  };

  // ---- payment-type options ----
  const optionRows = (
    (await db.execute(sql`SELECT id, name, currency_code FROM options_ledger_payment_type`)) as unknown as {
      rows: Array<{ id: string; name: string; currency_code: string }>;
    }
  ).rows;
  const optionIds = new Set(optionRows.map((r) => r.id));
  const typeCurrency = new Map(optionRows.map((r) => [r.id, r.currency_code] as const));

  // Crash-repair provenance: a payment created before its putMapping landed is
  // re-found by its stashed s1Nid and re-adopted into id_map instead of duplicated.
  const provenanceRes = await db.execute(sql`
    SELECT id, details->>'s1Nid' AS nid FROM ledger_payments
    WHERE details->>'source' = 's1-migration' AND details->>'s1Nid' IS NOT NULL
  `);
  const provenanceByNid = new Map<number, string>();
  for (const r of (provenanceRes as unknown as { rows: Array<{ id: string; nid: string }> }).rows) {
    const n = Number(r.nid);
    if (Number.isFinite(n) && !provenanceByNid.has(n)) provenanceByNid.set(n, r.id);
  }

  // Currency preflight map — replaces the storage create() cross-check that
  // createForMigration deliberately skips.
  const acctCurrencyRes = await db.execute(sql`SELECT id, currency_code FROM ledger_accounts`);
  const acctCurrency = new Map(
    (acctCurrencyRes as unknown as { rows: Array<{ id: string; currency_code: string }> }).rows.map(
      (r) => [r.id, r.currency_code] as const,
    ),
  );

  // ---- global counters (accumulated across pages) ----
  let created = 0;
  let adopted = 0;
  let adoptedByProvenance = 0;
  let negativeAmounts = 0;
  let payerContactEAs = 0;
  let verifyFailures = 0;
  const verifySamples: Array<Record<string, unknown>> = [];
  const perStatus: Record<string, number> = {};
  const eaCache = new Map<string, string>();
  let pages = 0;

  // ---- keyset-paged pipeline: resolve → write → verify per page. Staged
  // rows, id_map lookups and verification reads are page-bounded so memory
  // stays flat at production volume.
  for await (const staged of pagedStaged(BUNDLE)) {
    pages++;

    // ---- per-page bulk id_map lookups ----
    const typeTids: number[] = [];
    const payerNids: number[] = [];
    for (const s of staged) {
      const t = tidOf(s.fields, "field_sirius_payment_type");
      if (t != null) typeTids.push(t);
      const p = targetNidOf(s.fields, "field_sirius_payer");
      if (p != null) payerNids.push(p);
    }
    const [termMap, paymentMap] = await Promise.all([
      getMappings("term", typeTids),
      getMappings("payment", staged.map((s) => s.nid)),
    ]);
    const resolveEntity = await buildEntityResolver(payerNids);

    const expectations: Array<{
      nid: number;
      s2Id: string;
      amount: string;
      status: S2PaymentStatus;
      ledgerEaId: string | null; // null = adopted before EA resolution (dry)
    }> = [];

    for (const s of staged) {
    const nid = s.nid;
    const f = s.fields;

    const statusRaw = strOf(f, "field_sirius_payment_status");
    if (!statusRaw) {
      rejects.add("status_missing", { nid }, nid);
      continue;
    }
    const mapped = STATUS_MAP[statusRaw.trim().toLowerCase()];
    if (!mapped) {
      rejects.add("status_unmapped", { nid, status: statusRaw }, nid);
      continue;
    }

    const amtRaw = strOf(f, "field_sirius_dollar_amt");
    if (!amtRaw) {
      rejects.add("amount_missing", { nid }, nid);
      continue;
    }
    if (!AMOUNT_RE.test(amtRaw.trim())) {
      rejects.add("bad_amount", { nid }, nid);
      continue;
    }
    const isNegative = amtRaw.trim().startsWith("-");
    const amount = isNegative ? amtRaw.trim().slice(1) : amtRaw.trim();
    if (isNegative) negativeAmounts++;

    const dtRaw = strOf(f, "field_sirius_datetime_created");
    if (!dtRaw) {
      rejects.add("date_missing", { nid }, nid);
      continue;
    }
    const dateCreated = parseUtcInstant(dtRaw);
    if (!dateCreated) {
      rejects.add("bad_date", { nid }, nid);
      continue;
    }

    const accountNid = targetNidOf(f, "field_sirius_ledger_account");
    if (accountNid == null) {
      rejects.add("account_ref_missing", { nid }, nid);
      continue;
    }
    const accountId = accounts.map.get(accountNid);
    if (!accountId) {
      rejects.add("account_unensured", { nid, accountNid, reason: accounts.failed.get(accountNid) ?? "unstaged" }, nid);
      continue;
    }

    const payerNid = targetNidOf(f, "field_sirius_payer");
    if (payerNid == null) {
      rejects.add("payer_ref_missing", { nid }, nid);
      continue;
    }
    const entity = resolveEntity(payerNid);
    if (!entity) {
      rejects.add("payer_unmapped", { nid, payerNid }, nid);
      continue;
    }
    if (entity.entityType === "contact") payerContactEAs++;

    const typeTid = tidOf(f, "field_sirius_payment_type");
    if (typeTid == null) {
      rejects.add("payment_type_missing", { nid }, nid);
      continue;
    }
    const paymentTypeId = termMap.get(typeTid)?.s2Id;
    if (!paymentTypeId) {
      rejects.add("payment_type_term_unmapped", { nid, tid: typeTid }, nid);
      continue;
    }
    if (!optionIds.has(paymentTypeId)) {
      rejects.add("payment_type_option_missing", { nid, tid: typeTid }, nid);
      continue;
    }

    // Currency preflight (see map above): a historical payment whose type and
    // account disagree on currency must be a counted reject, never a silent write.
    if (typeCurrency.get(paymentTypeId) !== acctCurrency.get(accountId)) {
      rejects.add("currency_mismatch", { nid, tid: typeTid }, nid);
      continue;
    }

    perStatus[mapped.status] = (perStatus[mapped.status] ?? 0) + 1;

    // idempotency: adopt mapped rows (verified below)
    const existingId = paymentMap.get(nid)?.s2Id;
    if (existingId) {
      adopted++;
      expectations.push({ nid, s2Id: existingId, amount, status: mapped.status, ledgerEaId: null });
      continue;
    }
    // crash-repair: row exists (provenance) but id_map lost the mapping
    const orphanId = provenanceByNid.get(nid);
    if (orphanId) {
      const winner = DRY_RUN ? orphanId : await putMapping("payment", nid, orphanId, { stub: false, loader: LOADER });
      adopted++;
      adoptedByProvenance++;
      expectations.push({ nid, s2Id: winner, amount, status: mapped.status, ledgerEaId: null });
      continue;
    }
    if (DRY_RUN) {
      created++;
      continue;
    }

    try {
      const eaKey = `${entity.entityType}|${entity.entityId}|${accountId}`;
      let eaId = eaCache.get(eaKey);
      if (!eaId) {
        const ea = await storage.ledger.ea.getOrCreate(entity.entityType, entity.entityId, accountId);
        eaId = ea.id;
        eaCache.set(eaKey, eaId);
      }
      const details: Record<string, unknown> = { source: "s1-migration", s1Nid: nid };
      const check = strOf(f, "field_sirius_check_number");
      if (check) details.s1CheckNumber = check;
      const merchant = strOf(f, "field_sirius_merchant_name");
      if (merchant) details.s1MerchantName = merchant;
      const alloc = strOf(f, "field_sirius_ledger_allocated");
      if (alloc) details.s1LedgerAllocated = alloc;
      if (isNegative) details.s1NegativeAmount = true;

      const row = await withNotificationsSuppressed(() =>
        withChargePluginsSuppressed(() =>
          storage.ledger.payments.createForMigration({
            status: mapped.status,
            allocated: mapped.status === "cleared",
            amount,
            paymentType: paymentTypeId!,
            ledgerEaId: eaId!,
            details,
            dateCreated,
            dateReceived: mapped.setReceived ? dateCreated : null,
            dateCleared: mapped.setCleared ? dateCreated : null,
            memo: null,
          }),
        ),
      );
      const winner = await putMapping("payment", nid, row.id, { stub: false, loader: LOADER });
      created++;
      expectations.push({ nid, s2Id: winner, amount, status: mapped.status, ledgerEaId: row.ledgerEaId });
    } catch {
      rejects.add("payment_create_failed", { nid }, nid);
    }
    }

    // ---- verify pass (page-scoped): exact row equality for every loaded payment ----
    for (const batch of chunk(expectations, 200)) {
      const rows = await storage.ledger.payments.getByIds(batch.map((e) => e.s2Id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const ex of batch) {
        const row = byId.get(ex.s2Id);
        const mismatches: string[] = [];
        if (!row) {
          mismatches.push("row_missing");
        } else {
          if (Number(row.amount) !== Number(ex.amount)) mismatches.push("amount");
          if (row.status !== ex.status) mismatches.push("status");
          if (ex.ledgerEaId && row.ledgerEaId !== ex.ledgerEaId) mismatches.push("ledgerEaId");
        }
        if (mismatches.length > 0) {
          verifyFailures++;
          if (verifySamples.length < 25) verifySamples.push({ nid: ex.nid, fields: mismatches });
        }
      }
    }
  }

  report.pages = pages;
  report.created = created;
  report.adopted = adopted;
  report.adoptedByProvenance = adoptedByProvenance;
  report.perStatus = perStatus;
  report.negativeAmounts = negativeAmounts;
  report.payerContactEAs = payerContactEAs;

  // ---- per-account aggregate parity (loaded s1 payments vs staged) ----
  const loadedAgg = (
    (await db.execute(sql`
      SELECT ea.account_id AS account_id, count(*)::int AS n, coalesce(sum(p.amount), 0)::text AS total
        FROM ledger_payments p JOIN ledger_ea ea ON ea.id = p.ledger_ea_id
       WHERE p.details->>'source' = 's1-migration'
       GROUP BY ea.account_id ORDER BY ea.account_id
    `)) as unknown as { rows: Array<{ account_id: string; n: number; total: string }> }
  ).rows;
  report.loadedPerAccount = loadedAgg;

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  if (verifySamples.length > 0) report.verifyFailureSamples = verifySamples;

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

  await pgPool.end();
  if (verifyFailures > 0) process.exit(1);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
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
