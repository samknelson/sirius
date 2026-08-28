/**
 * T18 loader — S1 raw AR ledger (sirius_ledger_ar table, staged as
 * s1_staging.raw_ledger_ar) → ledger entries. Load-order step: after T19
 * (payments) so AR rows referencing payment nids resolve via id_map.
 *
 * Rules (03-transformations T18, 06 §4.18):
 *   - Historical FACTS: chargePlugin='s1-import', chargePluginKey=
 *     'ar-<ledger_id>' — the (plugin,key) UNIQUE gives natural idempotency
 *     and no charge plugin ever re-derives these rows. Charge-plugin
 *     execution is additionally suppressed for the whole run.
 *   - Sign convention migrates AS-IS: positive = charges, negative =
 *     payment allocations/credits (S1 allocations arrive as negative rows;
 *     T19 loads the payments themselves with allocated=true).
 *   - Production AR is 100% Cleared (§4.18 Q19). Any other status is a
 *     fatal reject (non_cleared_status) — the synthetic dev DB contains a
 *     few Pending rows, allow them explicitly in dev runs only.
 *   - amount: staged verbatim decimal string, loaded unparsed (never
 *     floated); date = ledger_ts epoch instant; statement_ymd = first of
 *     the epoch's month in America/Los_Angeles (fund-local months).
 *   - account nid → T18a account map (id_map → adopt-by-name → create).
 *   - participant nid → worker → shell-worker → contact → employer (EA
 *     getOrCreate). Contact-typed EAs are counted for review.
 *   - reference nid → best-effort resolve across id_map entities
 *     (wb→wmb anchor, election, payment, worker, relation, employer,
 *     shell-worker/contact) using the RUNTIME reference-type vocabulary
 *     ('payment', 'wmb', …); unresolved keeps referenceType='s1-unknown'
 *     with the raw nid — data.s1ReferenceNid preserves it either way.
 *   - memo/key/json staged → memo column + data provenance (verbatim).
 *
 * SYNC (Task 295 — S1-wins dual-run reconciliation, RUNBOOK §10):
 *   - Identity: id_map entity 'ledger-ar' keyed by ledger_id; the row itself
 *     is found via chargePluginKey 'ar-<ledger_id>' (the durable identity —
 *     mapping s2_id is informational and self-heals when stale).
 *   - Unchanged rows (consumed fingerprint == staged content_hash at this
 *     LOGIC_VERSION) fast-skip all storage work; they still tally into the
 *     per-account verify expectation.
 *   - Changed rows update the existing entry IN PLACE through storage
 *     (amount/EA/reference/date/memo/data/statementYmd), under suppression.
 *   - Unmapped-but-existing rows (loaded before sync) are ADOPTED: rebuilt
 *     values are content-compared against the DB row — equal inserts only
 *     the mapping (bulk), different means S1 wins and the row is updated.
 *   - Deletion sweep: reverse keyset scan of ALL s1-import 'ar-*' rows;
 *     any key whose ledger_id is no longer staged as Cleared (deleted in S1
 *     OR status moved off Cleared) is hard-deleted through storage + its
 *     mapping removed. Foreign s1-import keys (other loaders' prefixes) are
 *     counted and left alone; unparsable keys are parity's problem.
 *   - A staged row that REJECTS this run (e.g. bad_amount after an S1 edit)
 *     while its S2 row exists is NOT deleted (still staged-Cleared) and NOT
 *     expected → the per-account verify fails LOUD. That's deliberate:
 *     reject-class churn on money rows needs operator triage, not silent
 *     convergence.
 *
 * Verification: per-account count + sum (cents-exact) of every RESOLVED
 * staged row vs the DB's s1-import entries for that account (post-sweep).
 * Aggregates only — this is the N6 balance-parity building block.
 * Fingerprints for updated rows advance only after verify passes (creates/
 * adopts stamp at mapping-insert per putMapping convention).
 *
 * Usage: npx tsx scripts/s1-migration/load-ledger.ts \
 *          [--dry-run] [--allow-rejects r1,r2] [--force-reconcile]
 * Output is aggregate counts only (no PII).
 */
import { storage } from "../../server/storage/database";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema, recordRun, pagedRawLedger, stagedRawLedgerCount, ensureRawLedgerTable } from "./lib/staging";
import { ensureIdMap, getMappings, putMappings, deleteMapping, remapMapping, advanceFingerprints, clearFingerprints, type MappingInfo } from "./lib/idmap";
import { RejectLog, LOADER_PAGE_SIZE, chunk, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import { buildEntityResolver, ensureLedgerAccounts, laStatementYmd } from "./lib/resolvers";
import { AMOUNT_RE, toCents as parseCents, centsToStr } from "./lib/parity";
import {
  canonicalJson,
  classifyRow,
  parseForceReconcile,
  parseAllowedFindings,
  buildLoaderResult,
  emitLoaderResult,
  loaderExitCode,
  emptySummary,
} from "./lib/sync";

const LOADER = "t18-ledger";
const ENTITY = "ledger-ar";
const LOGIC_VERSION = 2; // v2 (Task 414): payperiod crosswalk provenance (hours) / pay-period reference resolution (ledger)
const CHARGE_PLUGIN = "s1-import";
const KEY_RE = /^ar-(\d+)$/;
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

/** All reasons are row-skipping (fatal for that AR row). */
const FATAL_REASONS = [
  "non_cleared_status",
  "amount_missing",
  "bad_amount",
  "ts_missing",
  "account_ref_missing",
  "account_unensured",
  "participant_ref_missing",
  "participant_unmapped",
  "entry_create_failed",
  "entry_update_failed",
] as const;

/** "-6421.35" → integer cents. Inputs are AMOUNT_RE-validated (or DB numeric
 * text) so a null parse is impossible; shared exact math lives in lib/parity. */
const toCents = (amount: string): number => parseCents(amount) ?? 0;

/** Reference resolution priority (first id_map hit wins; nids are unique per
 * node so overlaps only exist for shell-worker vs contact, resolved worker-
 * first like participants). */
const REFERENCE_ENTITIES: Array<{ entity: string; referenceType: string }> = [
  // Runtime vocabulary: charge plugins write referenceType "wmb" for
  // worker-month-benefit rows and "payment" for payment allocations; every
  // consumer (payment history, transaction views, statement/invoice
  // classification) matches those exact strings. Migration-only names like
  // "ledger_payment"/"trust_wmb" leave imported rows invisible to them —
  // scripts/oneoffs/repair-s1-import-reference-types.ts repairs rows loaded
  // before this alignment.
  { entity: "wb", referenceType: "wmb" },
  { entity: "election", referenceType: "worker_trust_election" },
  { entity: "payment", referenceType: "payment" },
  // Pay-period crosswalk maintained by t20-hours (Task 414): S1 hours-charge
  // AR rows reference sirius_payperiod nids; the crosswalk resolves them to
  // the monthly worker_hours row those payperiods aggregated into. Runtime
  // vocabulary is "hour" — the same referenceType the bao-hourly charge
  // plugin writes — so consumers (transaction views, plugin reconciliation)
  // see imported hour charges exactly like native ones. REQUIRES the fleet
  // order payments → hours → ledger (sync-config asserts it).
  { entity: "payperiod", referenceType: "hour" },
  { entity: "worker", referenceType: "worker" },
  { entity: "shell-worker", referenceType: "worker" },
  { entity: "relation", referenceType: "worker_relation" },
  { entity: "employer", referenceType: "employer" },
  { entity: "contact", referenceType: "contact" },
];

/** Existing S2 s1-import row content needed for adopt-compare and updates. */
interface ExistingRow {
  id: string;
  key: string;
  amountCents: number;
  memo: string | null;
  eaId: string;
  statementYmd: string | null;
  dateEpoch: number | null;
  referenceType: string | null;
  referenceId: string | null;
  data: unknown;
}

async function fetchExistingByKeys(keys: string[]): Promise<Map<string, ExistingRow>> {
  const out = new Map<string, ExistingRow>();
  for (const batch of chunk(keys, 500)) {
    if (batch.length === 0) continue;
    const res = (await db.execute(sql`
      SELECT id, charge_plugin_key AS key, amount::text AS amount, memo, ea_id,
             statement_ymd, extract(epoch FROM date)::bigint AS date_epoch,
             reference_type, reference_id, data
        FROM ledger
       WHERE charge_plugin = ${CHARGE_PLUGIN}
         AND charge_plugin_key IN (${sql.join(batch.map((k) => sql`${k}`), sql`, `)})
    `)) as unknown as {
      rows: Array<{
        id: string; key: string; amount: string; memo: string | null; ea_id: string;
        statement_ymd: string | null; date_epoch: string | number | null;
        reference_type: string | null; reference_id: string | null; data: unknown;
      }>;
    };
    for (const r of res.rows) {
      out.set(r.key, {
        id: r.id,
        key: r.key,
        amountCents: toCents(r.amount),
        memo: r.memo ?? null,
        eaId: r.ea_id,
        statementYmd: r.statement_ymd ?? null,
        dateEpoch: r.date_epoch == null ? null : Number(r.date_epoch),
        referenceType: r.reference_type ?? null,
        referenceId: r.reference_id ?? null,
        data: r.data,
      });
    }
  }
  return out;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureRawLedgerTable();
  await ensureIdMap();

  const detail: Record<string, unknown> = {};
  const rejects = new RejectLog();
  const summary = emptySummary();

  detail.staged = await stagedRawLedgerCount();
  const byStatus: Record<string, number> = {};

  // throttle per-row storage-op logging + heartbeat (aggregates only)
  throttleStorageOpLogs();
  const progress = makeProgressLogger(LOADER, detail.staged as number);
  progress.phase("pre-scan");

  // ---- accounts (T18a: id_map → adopt-by-name → create) ----
  const accounts = await ensureLedgerAccounts(LOADER, DRY_RUN);
  detail.accounts = {
    staged: accounts.stagedAccounts,
    viaIdMap: accounts.viaIdMap,
    adoptedByName: accounts.adoptedByName,
    created: accounts.created,
    failed: accounts.failed.size,
  };

  // ---- global counters (accumulated across pages) ----
  let adopted = 0; // content-equal pre-sync rows that only gained a mapping
  let recreatedMissing = 0; // mapped rows whose S2 row vanished — recreated
  let participantContactEAs = 0;
  let positiveRows = 0;
  let negativeRows = 0;
  let staleFingerprintRows = 0; // staged rows with NULL content_hash (pre-sync staging)
  const refTypeCounts: Record<string, number> = {};
  const eaCache = new Map<string, string>();
  // expected per-account tallies (resolved rows only) for the verify pass
  const expected = new Map<string, { count: number; cents: number }>();
  // fingerprints to advance AFTER verify passes (updated rows only — creates
  // and adopts stamp at mapping-insert time)
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  let pages = 0;

  // ---- degraded-reference heal pre-pass. Rows loaded while their reference
  // target was unmapped carry referenceType='s1-unknown' (nid preserved in
  // data.s1ReferenceNid). Fingerprints capture source content only, so a
  // late-arriving mapping (payment deleted-then-restored in S1, extraction
  // recovery) would otherwise never re-resolve — the fast path would skip
  // the unchanged row forever. Each run re-checks the degraded set (small:
  // dominated by refs to S1-deleted nodes) and clears the ledger-ar
  // fingerprint of rows whose nid NOW resolves; the main loop below then
  // reclassifies them as changed and the standard update path rewrites the
  // reference. Still-unresolvable rows are left alone — no repeat writes.
  let refHealDegraded = 0;
  let refHealCleared = 0;
  let refHealHourDrift = 0;
  if (!DRY_RUN) {
    progress.phase("ref-heal");
    const degraded: Array<{ ledgerId: number; refNid: number }> = [];
    let lastKey = "";
    for (;;) {
      const res = (await db.execute(sql`
        SELECT charge_plugin_key AS k, (data->>'s1ReferenceNid')::bigint AS ref_nid
          FROM ledger
         WHERE charge_plugin = ${CHARGE_PLUGIN} AND reference_type = 's1-unknown'
           AND charge_plugin_key ~ '^ar-[0-9]+$' AND data->>'s1ReferenceNid' IS NOT NULL
           AND charge_plugin_key > ${lastKey}
         ORDER BY charge_plugin_key LIMIT 5000
      `)) as unknown as { rows: Array<{ k: string; ref_nid: string | number }> };
      for (const row of res.rows) degraded.push({ ledgerId: Number(row.k.slice(3)), refNid: Number(row.ref_nid) });
      if (res.rows.length < 5000) break;
      lastKey = res.rows[res.rows.length - 1].k;
    }
    refHealDegraded = degraded.length;
    if (degraded.length > 0) {
      const resolvable = new Set<number>();
      for (const batch of chunk([...new Set(degraded.map((d) => d.refNid))], 500)) {
        for (const { entity } of REFERENCE_ENTITIES) {
          const m = await getMappings(entity, batch);
          for (const nid of batch) if (m.has(nid)) resolvable.add(nid);
        }
      }
      const healIds = degraded.filter((d) => resolvable.has(d.refNid)).map((d) => d.ledgerId);
      if (healIds.length > 0) {
        await clearFingerprints(ENTITY, healIds);
        refHealCleared = healIds.length;
      }
    }

    // ---- drifted hour-link heal (Task 414). A payperiod retargeted to a
    // different month (crosswalk repointed) or deleted in S1 (mapping
    // retired) changes the AR row's correct reference WITHOUT changing its
    // source content, so the fingerprint fast path would keep the stale
    // 'hour' link forever — pointing at an old/deleted worker_hours row and
    // hiding the imported base from the BAO plugin on the new row. Re-check
    // every hour-linked ar-* row against the CURRENT payperiod crosswalk and
    // clear fingerprints where the target differs or vanished; the main loop
    // then rewrites the reference (or degrades it back to 's1-unknown')
    // through the standard update path. Scoped to payperiod-provenance rows
    // only (data.s1ReferenceNid + referenceType='hour').
    const hourLinked: Array<{ ledgerId: number; refNid: number; refId: string }> = [];
    let lastHourKey = "";
    for (;;) {
      const res = (await db.execute(sql`
        SELECT charge_plugin_key AS k, (data->>'s1ReferenceNid')::bigint AS ref_nid, reference_id AS ref_id
          FROM ledger
         WHERE charge_plugin = ${CHARGE_PLUGIN} AND reference_type = 'hour'
           AND charge_plugin_key ~ '^ar-[0-9]+$' AND data->>'s1ReferenceNid' IS NOT NULL
           AND charge_plugin_key > ${lastHourKey}
         ORDER BY charge_plugin_key LIMIT 5000
      `)) as unknown as { rows: Array<{ k: string; ref_nid: string | number; ref_id: string }> };
      for (const row of res.rows) {
        hourLinked.push({ ledgerId: Number(row.k.slice(3)), refNid: Number(row.ref_nid), refId: String(row.ref_id) });
      }
      if (res.rows.length < 5000) break;
      lastHourKey = res.rows[res.rows.length - 1].k;
    }
    if (hourLinked.length > 0) {
      const currentTarget = new Map<number, string>();
      for (const batch of chunk([...new Set(hourLinked.map((d) => d.refNid))], 500)) {
        const m = await getMappings("payperiod", batch);
        for (const [nid, info] of m) currentTarget.set(nid, info.s2Id);
      }
      const driftedIds = hourLinked
        .filter((d) => currentTarget.get(d.refNid) !== d.refId) // repointed OR retired
        .map((d) => d.ledgerId);
      if (driftedIds.length > 0) {
        await clearFingerprints(ENTITY, driftedIds);
        refHealHourDrift = driftedIds.length;
      }
    }
  }

  // ---- keyset-paged pipeline. Staged AR rows, participant/reference id_map
  // lookups, ledger-ar sync classification and the batched content fetch are
  // all page-bounded. Unchanged rows cost zero row-level queries — the page
  // maps (participants, references, mappings) are the only steady-state work.
  for await (const staged of pagedRawLedger(LOADER_PAGE_SIZE)) {
    pages++;
    progress.phase(null);
    for (const r of staged) byStatus[r.status ?? "NULL"] = (byStatus[r.status ?? "NULL"] ?? 0) + 1;

    // ---- per-page participant + reference resolution maps ----
    const participantNids = staged.map((r) => r.participant).filter((n): n is number => n != null);
    const resolveEntity = await buildEntityResolver(participantNids);

    const refNids = [...new Set(staged.map((r) => r.reference).filter((n): n is number => n != null))];
    const refMaps = new Map<string, Map<number, { s2Id: string; stub: boolean }>>();
    await Promise.all(
      REFERENCE_ENTITIES.map(async ({ entity }) => {
        refMaps.set(entity, await getMappings(entity, refNids));
      }),
    );
    const resolveReference = (nid: number): { referenceType: string; referenceId: string } => {
      for (const { entity, referenceType } of REFERENCE_ENTITIES) {
        const hit = refMaps.get(entity)?.get(nid);
        if (hit) return { referenceType, referenceId: hit.s2Id };
      }
      return { referenceType: "s1-unknown", referenceId: String(nid) };
    };

    // ---- sync classification (page-batched) ----
    const mappings: Map<number, MappingInfo> = await getMappings(ENTITY, staged.map((r) => r.ledgerId));
    const dispositions = new Map<number, "new" | "changed" | "unchanged">();
    for (const r of staged) {
      dispositions.set(
        r.ledgerId,
        classifyRow(mappings.get(r.ledgerId), r.contentHash ?? null, LOGIC_VERSION, FORCE_RECONCILE),
      );
      if (r.contentHash == null) staleFingerprintRows++;
    }

    // ---- batched existing-row fetch — only rows that may need storage work
    // (everything except the unchanged fast path) ----
    const keysNeedingRow = staged
      .filter((r) => dispositions.get(r.ledgerId) !== "unchanged")
      .map((r) => `ar-${r.ledgerId}`);
    const existingRows = await fetchExistingByKeys(keysNeedingRow);

    // page-local mapping inserts, bulk-flushed at page end
    const newMappings: Array<{ s1Id: number; s2Id: string; fingerprint: string | null }> = [];

    for (const r of staged) {
    progress.add(1);
    const id = r.ledgerId;

    if ((r.status ?? "").trim().toLowerCase() !== "cleared") {
      rejects.add("non_cleared_status", { ledgerId: id, status: r.status }, id);
      continue;
    }
    if (r.amount == null || r.amount.trim() === "") {
      rejects.add("amount_missing", { ledgerId: id }, id);
      continue;
    }
    const amount = r.amount.trim();
    if (!AMOUNT_RE.test(amount)) {
      rejects.add("bad_amount", { ledgerId: id }, id);
      continue;
    }
    if (r.ts == null) {
      rejects.add("ts_missing", { ledgerId: id }, id);
      continue;
    }
    const tsEpoch = r.ts; // capture post-guard: narrowing doesn't survive into the closure below
    if (r.account == null) {
      rejects.add("account_ref_missing", { ledgerId: id }, id);
      continue;
    }
    const accountId = accounts.map.get(r.account);
    if (!accountId) {
      rejects.add("account_unensured", { ledgerId: id, accountNid: r.account, reason: accounts.failed.get(r.account) ?? "unstaged" }, id);
      continue;
    }
    if (r.participant == null) {
      rejects.add("participant_ref_missing", { ledgerId: id }, id);
      continue;
    }
    const entity = resolveEntity(r.participant);
    if (!entity) {
      rejects.add("participant_unmapped", { ledgerId: id, participantNid: r.participant }, id);
      continue;
    }
    if (entity.entityType === "contact") participantContactEAs++;

    const cents = toCents(amount);
    if (cents >= 0) positiveRows++;
    else negativeRows++;

    const ref = r.reference != null ? resolveReference(r.reference) : null;
    if (ref) refTypeCounts[ref.referenceType] = (refTypeCounts[ref.referenceType] ?? 0) + 1;

    const chargePluginKey = `ar-${id}`;
    const disposition = dispositions.get(id)!;
    const mapping = mappings.get(id);

    // Track expectation regardless of path — verify compares the DB's
    // s1-import aggregate per account to the full resolved set (post-sweep).
    const agg = expected.get(accountId) ?? { count: 0, cents: 0 };
    agg.count++;
    agg.cents += cents;
    expected.set(accountId, agg);

    if (disposition === "unchanged") {
      summary.unchanged++;
      continue;
    }

    if (DRY_RUN) {
      // Classification-only counters; no EA resolution, no content compare.
      const existing = existingRows.get(chargePluginKey);
      if (mapping) summary.updated++;
      else if (existing) adopted++; // would adopt-or-update (content not compared in dry-run)
      else summary.created++;
      continue;
    }

    try {
      const existing = existingRows.get(chargePluginKey);
      const eaKey = `${entity.entityType}|${entity.entityId}|${accountId}`;
      let eaId = eaCache.get(eaKey);
      if (!eaId) {
        const ea = await storage.ledger.ea.getOrCreate(entity.entityType, entity.entityId, accountId);
        eaId = ea.id;
        eaCache.set(eaKey, eaId);
      }
      const data: Record<string, unknown> = { source: "s1-migration", s1LedgerId: id };
      if (r.key) data.s1Key = r.key;
      if (r.reference != null) data.s1ReferenceNid = r.reference;
      if (r.json && r.json.trim() !== "") data.s1Json = r.json;

      const desired = {
        amount,
        eaId: eaId!,
        referenceType: ref?.referenceType ?? null,
        referenceId: ref?.referenceId ?? null,
        date: new Date(tsEpoch * 1000),
        memo: r.memo,
        data,
        statementYmd: laStatementYmd(tsEpoch),
      };

      if (!existing) {
        // New in S1 — or a mapped row whose S2 row vanished (self-heal).
        const row = await withNotificationsSuppressed(() =>
          withChargePluginsSuppressed(() =>
            storage.ledger.entries.create({
              chargePlugin: CHARGE_PLUGIN,
              chargePluginKey,
              chargePluginConfigId: null,
              ...desired,
            }),
          ),
        );
        if (mapping) {
          recreatedMissing++;
          await remapMapping(ENTITY, id, row.id, LOADER);
          pendingAdvance.push({ s1Id: id, fingerprint: r.contentHash ?? null });
        } else {
          newMappings.push({ s1Id: id, s2Id: row.id, fingerprint: r.contentHash ?? null });
        }
        summary.created++;
        continue;
      }

      // Row exists. Adopt-compare (unmapped) or S1-wins update (changed).
      const contentEqual =
        existing.amountCents === cents &&
        (existing.memo ?? null) === (r.memo ?? null) &&
        existing.eaId === desired.eaId &&
        (existing.statementYmd ?? null) === desired.statementYmd &&
        existing.dateEpoch === tsEpoch &&
        (existing.referenceType ?? null) === desired.referenceType &&
        (existing.referenceId ?? null) === desired.referenceId &&
        canonicalJson(existing.data ?? null) === canonicalJson(data);

      if (!mapping && contentEqual) {
        // Pre-sync row already in the desired state — mapping only.
        newMappings.push({ s1Id: id, s2Id: existing.id, fingerprint: r.contentHash ?? null });
        adopted++;
        continue;
      }

      const updated = await withNotificationsSuppressed(() =>
        withChargePluginsSuppressed(() => storage.ledger.entries.update(existing.id, desired)),
      );
      if (!updated) throw new Error("update returned no row");
      if (mapping) {
        if (mapping.s2Id !== existing.id) await remapMapping(ENTITY, id, existing.id, LOADER);
        pendingAdvance.push({ s1Id: id, fingerprint: r.contentHash ?? null });
      } else {
        newMappings.push({ s1Id: id, s2Id: existing.id, fingerprint: r.contentHash ?? null });
      }
      summary.updated++;
    } catch {
      // Which write failed: an existing row means the update path, otherwise
      // the create path (including mapped-but-vanished recreates).
      const reason = existingRows.has(chargePluginKey) ? "entry_update_failed" : "entry_create_failed";
      rejects.add(reason, { ledgerId: id }, id);
      // remove from expectation — the row did not land
      const back = expected.get(accountId)!;
      back.count--;
      back.cents -= cents;
    }
    }

    if (!DRY_RUN && newMappings.length > 0) {
      await putMappings(ENTITY, newMappings, { loader: LOADER, logicVersion: LOGIC_VERSION });
    }
  }

  detail.pages = pages;
  detail.stagedByStatus = byStatus;
  detail.adopted = adopted;
  detail.recreatedMissing = recreatedMissing;
  detail.staleFingerprintRows = staleFingerprintRows;
  detail.refHeal = { degraded: refHealDegraded, cleared: refHealCleared, hourDrift: refHealHourDrift };
  detail.positiveRows = positiveRows;
  detail.negativeRows = negativeRows;
  detail.participantContactEAs = participantContactEAs;
  detail.referenceTypes = refTypeCounts;

  // ---- deletion sweep: reverse scan of S2 s1-import 'ar-*' rows against the
  // staged Cleared set. Runs BEFORE verify so per-account aggregates reflect
  // the post-sweep state. NOT sweepDeletions(): pre-sync rows have no id_map
  // entry, and status-flips-off-Cleared must sweep even though the staged row
  // still exists — the charge-plugin key IS the identity here.
  progress.phase("sweep");
  const sweep = { candidates: 0, deleted: 0, alreadyGone: 0, foreignKeys: 0, unparsableKeys: 0 };
  {
    let lastId = "";
    for (;;) {
      const res = (await db.execute(sql`
        SELECT id, charge_plugin_key AS key FROM ledger
         WHERE charge_plugin = ${CHARGE_PLUGIN} AND id > ${lastId}
         ORDER BY id LIMIT 5000
      `)) as unknown as { rows: Array<{ id: string; key: string | null }> };
      if (res.rows.length === 0) break;
      lastId = res.rows[res.rows.length - 1].id;

      const parsed: Array<{ key: string; ledgerId: number }> = [];
      for (const row of res.rows) {
        const m = row.key == null ? null : KEY_RE.exec(row.key);
        if (!m) {
          if (row.key != null && row.key !== "" && !row.key.startsWith("ar-")) sweep.foreignKeys++;
          else sweep.unparsableKeys++;
          continue;
        }
        parsed.push({ key: row.key!, ledgerId: Number(m[1]) });
      }

      for (const batch of chunk(parsed, 500)) {
        if (batch.length === 0) continue;
        const staged = (await db.execute(sql`
          SELECT ledger_id FROM s1_staging.raw_ledger_ar
           WHERE ledger_id IN (${sql.join(batch.map((b) => sql`${b.ledgerId}`), sql`, `)})
             AND lower(trim(coalesce(ledger_status, ''))) = 'cleared'
        `)) as unknown as { rows: Array<{ ledger_id: string | number }> };
        const present = new Set(staged.rows.map((s) => Number(s.ledger_id)));
        for (const b of batch) {
          if (present.has(b.ledgerId)) continue;
          sweep.candidates++;
          if (DRY_RUN) continue;
          const gone = await withNotificationsSuppressed(() =>
            withChargePluginsSuppressed(() =>
              storage.ledger.entries.deleteByChargePluginKey(CHARGE_PLUGIN, b.key),
            ),
          );
          if (gone) sweep.deleted++;
          else sweep.alreadyGone++;
          await deleteMapping(ENTITY, b.ledgerId);
        }
      }
      if (res.rows.length < 5000) break;
    }
  }
  summary.deleted = sweep.deleted;
  detail.sweep = sweep;

  // ---- verify pass: per-account count + cents-exact sum parity ----
  progress.phase("verify");
  let verifyFailures = 0;
  const perAccount: Array<Record<string, unknown>> = [];
  if (!DRY_RUN) {
    const loaded = (
      (await db.execute(sql`
        SELECT ea.account_id AS account_id, count(*)::int AS n,
               coalesce(sum(l.amount), 0)::text AS total
          FROM ledger l JOIN ledger_ea ea ON ea.id = l.ea_id
         WHERE l.charge_plugin = ${CHARGE_PLUGIN}
         GROUP BY ea.account_id
      `)) as unknown as { rows: Array<{ account_id: string; n: number; total: string }> }
    ).rows;
    const loadedByAccount = new Map(loaded.map((r) => [r.account_id, r]));
    const allAccountIds = new Set([...expected.keys(), ...loadedByAccount.keys()]);
    for (const accountId of allAccountIds) {
      const want = expected.get(accountId) ?? { count: 0, cents: 0 };
      const got = loadedByAccount.get(accountId);
      const gotCount = got?.n ?? 0;
      const gotCents = got ? toCents(got.total) : 0;
      const ok = gotCount === want.count && gotCents === want.cents;
      if (!ok) verifyFailures++;
      perAccount.push({
        accountId,
        expectedCount: want.count,
        loadedCount: gotCount,
        expectedSum: centsToStr(want.cents),
        loadedSum: centsToStr(gotCents),
        ok,
      });
    }
  }
  detail.perAccount = perAccount;

  // ---- advance fingerprints for updated rows — only when verify passed.
  // The aggregate verify cannot attribute a failure to specific rows, so on
  // any failure NOTHING advances and the next run reconciles them again.
  if (!DRY_RUN && verifyFailures === 0 && pendingAdvance.length > 0) {
    await advanceFingerprints(ENTITY, pendingAdvance, LOGIC_VERSION);
  }
  detail.fingerprintsAdvanced = DRY_RUN || verifyFailures > 0 ? 0 : pendingAdvance.length;
  progress.stop();

  detail.rejectSamples = rejects.samples;

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings: [],
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
  if (process.env.S1_MIGRATION_DEBUG === "1") console.error(err);
  else if (err instanceof Error) console.error(`FATAL ${err.constructor.name}: ${String(err.message).split("\n")[0]}`);
  else console.error("FATAL: unknown_error");
  process.exit(1);
});
