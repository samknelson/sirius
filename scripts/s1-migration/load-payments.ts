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
 * SYNC (Task 295 — S1-wins dual-run reconciliation, RUNBOOK §10):
 *   - id_map entity `payment` carries consumed fingerprints (staged
 *     content_hash) at LOGIC_VERSION. Unchanged mapped rows fast-skip —
 *     including the verify pass, which therefore re-checks exactly the rows
 *     each run wrote.
 *   - Changed mapped rows are UPDATED in place via updateForMigration with
 *     every migration-owned field (status/allocated/amount/type/EA/details/
 *     dates); memo stays untouched (S2-side annotations survive). Fingerprints
 *     advance per page AFTER the row verifies.
 *   - Crash-repair provenance adoption stays: an unmapped row found by
 *     details.s1Nid re-enters id_map (no fingerprint) and is immediately
 *     reconciled as a changed row this run.
 *   - Deletion sweep: mapped payments whose staged source vanished are
 *     hard-deleted through storage (payments.delete also removes the
 *     payment's referencing ledger rows and emits their events so paid-state
 *     recompute re-queues — deliberate) and their mapping removed. Before
 *     the delete, the sweep drops the id_map `ledger-ar` mappings of any
 *     referencing s1-import `ar-*` rows the cascade is about to remove —
 *     otherwise those rows would keep a matching fingerprint and the next
 *     T18 run would fast-skip them as unchanged instead of recreating them.
 *     Mapping-drop happens FIRST for crash safety: mapping-gone-but-row-
 *     present converges via T18's adopt path, while row-gone-but-mapping-
 *     present would be a permanent hole. Still-staged AR rows then recreate
 *     on the T18 run that follows T19 in the sync order (no --force needed).
 *     Referencing s1-import rows with non-`ar-*` keys belong to other
 *     loaders (e.g. T16); they are counted in the sweep report for triage.
 *
 * Usage: npx tsx scripts/s1-migration/load-payments.ts \
 *          [--dry-run] [--allow-rejects r1,r2] [--force-reconcile]
 * Output is aggregate counts only (no PII).
 */
import { storage } from "../../server/storage/database";
import { getEnvironmentVariable } from "./lib/script-env";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints, deleteMapping } from "./lib/idmap";
import { RejectLog, pagedStaged, stagedCountOf, chunk, strOf, tidOf, targetNidOf, toYmd, parseUtcInstant, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import { buildEntityResolver, ensureLedgerAccounts } from "./lib/resolvers";
import { AMOUNT_RE, PAYMENT_STATUS_MAP as STATUS_MAP, type S2PaymentStatus } from "./lib/parity";
import {
  classifyRow,
  parseForceReconcile,
  parseAllowedFindings,
  sweepDeletions,
  buildLoaderResult,
  emitLoaderResult,
  loaderExitCode,
  emptySummary,
} from "./lib/sync";

const LOADER = "t19-payments";
const BUNDLE = "sirius_payment";
const ENTITY = "payment";
const LOGIC_VERSION = 1;
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
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
  "currency_mismatch",
  "payment_create_failed",
  "payment_update_failed",
  "mapped_row_missing",
] as const;


async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const detail: Record<string, unknown> = {};
  const rejects = new RejectLog();
  const summary = emptySummary();
  throttleStorageOpLogs();

  detail.staged = await stagedCountOf(BUNDLE);

  // heartbeat: aggregates only (counts/elapsed/rate — never row contents)
  const progress = makeProgressLogger(LOADER, detail.staged as number);
  progress.phase("pre-scan");

  // ---- accounts (T18a shared policy: id_map → adopt by name → create) ----
  const accounts = await ensureLedgerAccounts(LOADER, DRY_RUN);
  detail.accounts = {
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
  // createForMigration/updateForMigration deliberately skip.
  const acctCurrencyRes = await db.execute(sql`SELECT id, currency_code FROM ledger_accounts`);
  const acctCurrency = new Map(
    (acctCurrencyRes as unknown as { rows: Array<{ id: string; currency_code: string }> }).rows.map(
      (r) => [r.id, r.currency_code] as const,
    ),
  );

  // ---- global counters (accumulated across pages) ----
  let adoptedByProvenance = 0;
  let negativeAmounts = 0;
  let payerContactEAs = 0;
  let staleFingerprintRows = 0; // staged rows with NULL content_hash (pre-sync staging)
  let verifyFailures = 0;
  let fingerprintsAdvanced = 0;
  const verifySamples: Array<Record<string, unknown>> = [];
  const perStatus: Record<string, number> = {};
  const eaCache = new Map<string, string>();
  let pages = 0;

  // ---- keyset-paged pipeline: classify → resolve → write → verify →
  // advance per page. Staged rows, id_map lookups and verification reads are
  // page-bounded so memory stays flat at production volume. Unchanged mapped
  // rows fast-skip everything (resolution, writes AND verify) — the verify
  // pass therefore re-checks exactly the rows this run wrote.
  for await (const staged of pagedStaged(BUNDLE)) {
    pages++;
    progress.phase(null);

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
      getMappings(ENTITY, staged.map((s) => s.nid)),
    ]);
    const resolveEntity = await buildEntityResolver(payerNids);

    const expectations: Array<{
      nid: number;
      s2Id: string;
      amount: string;
      status: S2PaymentStatus;
      allocated: boolean;
      ledgerEaId: string;
    }> = [];
    // fingerprints advanced after the page verify, minus failed rows
    const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];

    for (const s of staged) {
    progress.add(1);
    const nid = s.nid;
    const f = s.fields;
    if (s.contentHash == null) staleFingerprintRows++;

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

    // ---- sync classification ----
    const mapping = paymentMap.get(nid);
    const disposition = classifyRow(mapping, s.contentHash ?? null, LOGIC_VERSION, FORCE_RECONCILE);

    if (disposition === "unchanged") {
      summary.unchanged++;
      continue;
    }

    // crash-repair: row exists (provenance) but id_map lost the mapping —
    // adopt the mapping (no fingerprint) and reconcile it as changed NOW.
    let targetId = mapping?.s2Id;
    let viaProvenance = false;
    if (!targetId) {
      const orphanId = provenanceByNid.get(nid);
      if (orphanId) {
        viaProvenance = true;
        targetId = DRY_RUN ? orphanId : await putMapping(ENTITY, nid, orphanId, { stub: false, loader: LOADER });
        adoptedByProvenance++;
      }
    }

    if (DRY_RUN) {
      if (targetId) summary.updated++;
      else summary.created++;
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

      const allocated = mapped.status === "cleared";

      if (targetId) {
        // S1 wins: rewrite every migration-owned field on the mapped row.
        // memo is deliberately NOT touched (S2-side annotations survive).
        const row = await withNotificationsSuppressed(() =>
          withChargePluginsSuppressed(() =>
            storage.ledger.payments.updateForMigration(targetId!, {
              status: mapped.status,
              allocated,
              amount,
              paymentType: paymentTypeId!,
              ledgerEaId: eaId!,
              details,
              dateCreated,
              dateReceived: mapped.setReceived ? dateCreated : null,
              dateCleared: mapped.setCleared ? dateCreated : null,
            }),
          ),
        );
        if (!row) {
          // Mapping (or provenance) points at a vanished row — operator
          // repairs id_map; never silently re-create under a stale mapping.
          rejects.add("mapped_row_missing", { nid }, nid);
          continue;
        }
        summary.updated++;
        expectations.push({ nid, s2Id: row.id, amount, status: mapped.status, allocated, ledgerEaId: eaId! });
        pendingAdvance.push({ s1Id: nid, fingerprint: s.contentHash ?? null });
        if (viaProvenance) { /* counted above */ }
        continue;
      }

      const row = await withNotificationsSuppressed(() =>
        withChargePluginsSuppressed(() =>
          storage.ledger.payments.createForMigration({
            status: mapped.status,
            allocated,
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
      const winner = await putMapping(ENTITY, nid, row.id, {
        stub: false,
        loader: LOADER,
        fingerprint: s.contentHash ?? null,
        logicVersion: LOGIC_VERSION,
      });
      summary.created++;
      expectations.push({ nid, s2Id: winner, amount, status: mapped.status, allocated, ledgerEaId: row.ledgerEaId });
    } catch {
      rejects.add(targetId ? "payment_update_failed" : "payment_create_failed", { nid }, nid);
    }
    }

    // ---- verify pass (page-scoped): exact row equality for every row this
    // run wrote (created, updated, provenance-adopted) ----
    progress.phase("verify", expectations.length);
    const failedNids = new Set<number>();
    for (const batch of chunk(expectations, 200)) {
      progress.add(batch.length);
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
          if (row.allocated !== ex.allocated) mismatches.push("allocated");
          if (row.ledgerEaId !== ex.ledgerEaId) mismatches.push("ledgerEaId");
        }
        if (mismatches.length > 0) {
          verifyFailures++;
          failedNids.add(ex.nid);
          if (verifySamples.length < 25) verifySamples.push({ nid: ex.nid, fields: mismatches });
        }
      }
    }

    // ---- advance fingerprints for verified updated rows (created rows were
    // stamped at putMapping insert; failed rows stay retryable) ----
    if (!DRY_RUN) {
      const ok = pendingAdvance.filter((p) => !failedNids.has(p.s1Id));
      if (ok.length > 0) {
        await advanceFingerprints(ENTITY, ok, LOGIC_VERSION);
        fingerprintsAdvanced += ok.length;
      }
    }
  }

  // ---- deletion sweep: mapped payments whose staged source vanished.
  // payments.delete also removes the payment's referencing ledger rows and
  // emits their delete events (paid-state recompute re-queues). Cascaded
  // s1-import `ar-*` rows must ALSO lose their id_map `ledger-ar` mappings
  // (dropped BEFORE the delete — crash-safe direction), or the next T18 run
  // would fast-skip the still-staged AR rows as unchanged and never recreate
  // them. With the mappings gone, the T18 run after T19 recreates them via
  // its standard new-row/adopt path — no --force-reconcile required.
  progress.phase("sweep");
  let cascadedArMappingsDropped = 0;
  let foreignS1ImportCascades = 0;
  const foreignCascadeSampleKeys: string[] = [];
  const sweep = await sweepDeletions({
    entity: ENTITY,
    loaders: [LOADER],
    sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = ${BUNDLE}`,
    dryRun: DRY_RUN,
    policy: async (c) => ({
      action: "delete",
      apply: async () => {
        const refRows = (await db.execute(sql`
          SELECT charge_plugin_key FROM ledger
           WHERE reference_type = 'payment' AND reference_id = ${c.s2Id}
             AND charge_plugin = 's1-import'
        `)) as unknown as { rows: Array<{ charge_plugin_key: string | null }> };
        for (const r of refRows.rows) {
          const key = r.charge_plugin_key ?? "";
          const m = /^ar-(\d+)$/.exec(key);
          if (m) {
            await deleteMapping("ledger-ar", Number(m[1]));
            cascadedArMappingsDropped++;
          } else {
            foreignS1ImportCascades++;
            if (foreignCascadeSampleKeys.length < 5) foreignCascadeSampleKeys.push(key);
          }
        }
        await withNotificationsSuppressed(() =>
          withChargePluginsSuppressed(() => storage.ledger.payments.delete(c.s2Id)),
        );
      },
    }),
  });
  summary.deleted = sweep.deleted;
  detail.sweep = {
    candidates: sweep.candidates,
    deleted: sweep.deleted,
    alreadyHandled: sweep.alreadyHandled,
    cascadedArMappingsDropped,
    foreignS1ImportCascades,
    ...(foreignCascadeSampleKeys.length > 0 ? { foreignCascadeSampleKeys } : {}),
  };
  progress.stop();

  detail.pages = pages;
  detail.adoptedByProvenance = adoptedByProvenance;
  detail.perStatus = perStatus;
  detail.negativeAmounts = negativeAmounts;
  detail.payerContactEAs = payerContactEAs;
  detail.staleFingerprintRows = staleFingerprintRows;
  detail.fingerprintsAdvanced = fingerprintsAdvanced;

  // ---- per-account aggregate parity (loaded s1 payments vs staged) ----
  const loadedAgg = (
    (await db.execute(sql`
      SELECT ea.account_id AS account_id, count(*)::int AS n, coalesce(sum(p.amount), 0)::text AS total
        FROM ledger_payments p JOIN ledger_ea ea ON ea.id = p.ledger_ea_id
       WHERE p.details->>'source' = 's1-migration'
       GROUP BY ea.account_id ORDER BY ea.account_id
    `)) as unknown as { rows: Array<{ account_id: string; n: number; total: string }> }
  ).rows;
  detail.loadedPerAccount = loadedAgg;

  detail.rejectSamples = rejects.samples;
  if (verifySamples.length > 0) detail.verifyFailureSamples = verifySamples;

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings: sweep.findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);

  await pgPool.end();
  const code = loaderExitCode(result);
  if (code !== 0 && result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  process.exit(code);
}

main().catch((err) => {
  // HIPAA: never echo raw driver/storage errors (they can embed row values).
  // S1_MIGRATION_DEBUG=1 restores full errors for local debugging.
    if (getEnvironmentVariable("S1_MIGRATION_DEBUG") === "1") console.error(err);
  else if (err instanceof Error) console.error(`FATAL ${err.constructor.name}: ${String(err.message).split("\n")[0]}`);
  else console.error("FATAL: unknown_error");
  process.exit(1);
});
