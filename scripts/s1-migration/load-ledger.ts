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
 *     (wb→trust_wmb anchor, election, payment, worker, relation, employer,
 *     shell-worker/contact); unresolved keeps referenceType='s1-unknown'
 *     with the raw nid — data.s1ReferenceNid preserves it either way.
 *   - memo/key/json staged → memo column + data provenance (verbatim).
 *
 * Verification: per-account count + sum (cents-exact) of every RESOLVED
 * staged row vs the DB's s1-import entries for that account. Aggregates
 * only — this is the N6 balance-parity building block.
 *
 * Usage: npx tsx scripts/s1-migration/load-ledger.ts \
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
import { ensureStagingSchema, recordRun, pagedRawLedger, stagedRawLedgerCount, ensureRawLedgerTable } from "./lib/staging";
import { ensureIdMap, getMappings } from "./lib/idmap";
import { RejectLog, LOADER_PAGE_SIZE, chunk } from "./lib/loader-utils";
import { buildEntityResolver, ensureLedgerAccounts, laStatementYmd } from "./lib/resolvers";
import { AMOUNT_RE, toCents as parseCents, centsToStr } from "./lib/parity";

const LOADER = "t18-ledger";
const CHARGE_PLUGIN = "s1-import";
const DRY_RUN = process.argv.includes("--dry-run");
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
] as const;

/** "-6421.35" → integer cents. Inputs are AMOUNT_RE-validated (or DB numeric
 * text) so a null parse is impossible; shared exact math lives in lib/parity. */
const toCents = (amount: string): number => parseCents(amount) ?? 0;

/** Reference resolution priority (first id_map hit wins; nids are unique per
 * node so overlaps only exist for shell-worker vs contact, resolved worker-
 * first like participants). */
const REFERENCE_ENTITIES: Array<{ entity: string; referenceType: string }> = [
  { entity: "wb", referenceType: "trust_wmb" },
  { entity: "election", referenceType: "worker_trust_election" },
  { entity: "payment", referenceType: "ledger_payment" },
  { entity: "worker", referenceType: "worker" },
  { entity: "shell-worker", referenceType: "worker" },
  { entity: "relation", referenceType: "worker_relation" },
  { entity: "employer", referenceType: "employer" },
  { entity: "contact", referenceType: "contact" },
];

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureRawLedgerTable();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

  report.staged = await stagedRawLedgerCount();
  const byStatus: Record<string, number> = {};

  // ---- accounts (T18a: id_map → adopt-by-name → create) ----
  const accounts = await ensureLedgerAccounts(LOADER, DRY_RUN);
  report.accounts = {
    staged: accounts.stagedAccounts,
    viaIdMap: accounts.viaIdMap,
    adoptedByName: accounts.adoptedByName,
    created: accounts.created,
    failed: accounts.failed.size,
  };

  // ---- global counters (accumulated across pages) ----
  let created = 0;
  let adopted = 0;
  let participantContactEAs = 0;
  let positiveRows = 0;
  let negativeRows = 0;
  const refTypeCounts: Record<string, number> = {};
  const eaCache = new Map<string, string>();
  // expected per-account tallies (resolved rows only) for the verify pass
  const expected = new Map<string, { count: number; cents: number }>();
  let pages = 0;

  // ---- keyset-paged pipeline. Staged AR rows, participant/reference id_map
  // lookups and the chargePluginKey existence check are all page-bounded —
  // the per-row getByChargePluginKey is replaced by one batched IN-query set
  // per page. Per-account verify aggregates stay global (tiny).
  for await (const staged of pagedRawLedger(LOADER_PAGE_SIZE)) {
    pages++;
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

    // ---- batched existence check (replaces per-row getByChargePluginKey) ----
    const existingKeys = new Set<string>();
    if (!DRY_RUN) {
      for (const batch of chunk(staged, 500)) {
        const keys = batch.map((r) => `ar-${r.ledgerId}`);
        const res = (await db.execute(sql`
          SELECT charge_plugin_key FROM ledger
           WHERE charge_plugin = ${CHARGE_PLUGIN}
             AND charge_plugin_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
        `)) as unknown as { rows: Array<{ charge_plugin_key: string }> };
        for (const row of res.rows) existingKeys.add(row.charge_plugin_key);
      }
    }

    for (const r of staged) {
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

    // Track expectation regardless of created/adopted — verify compares
    // the DB's s1-import aggregate per account to the full resolved set.
    const agg = expected.get(accountId) ?? { count: 0, cents: 0 };
    agg.count++;
    agg.cents += cents;
    expected.set(accountId, agg);

    if (DRY_RUN) {
      created++;
      continue;
    }

    try {
      if (existingKeys.has(chargePluginKey)) {
        adopted++;
        continue;
      }
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

      await withNotificationsSuppressed(() =>
        withChargePluginsSuppressed(() =>
          storage.ledger.entries.create({
            chargePlugin: CHARGE_PLUGIN,
            chargePluginKey,
            chargePluginConfigId: null,
            amount,
            eaId: eaId!,
            referenceType: ref?.referenceType ?? null,
            referenceId: ref?.referenceId ?? null,
            date: new Date(tsEpoch * 1000),
            memo: r.memo,
            data,
            statementYmd: laStatementYmd(tsEpoch),
          }),
        ),
      );
      created++;
    } catch {
      rejects.add("entry_create_failed", { ledgerId: id }, id);
      // remove from expectation — the row did not land
      const back = expected.get(accountId)!;
      back.count--;
      back.cents -= cents;
    }
    }
  }

  report.pages = pages;
  report.stagedByStatus = byStatus;
  report.created = created;
  report.adopted = adopted;
  report.positiveRows = positiveRows;
  report.negativeRows = negativeRows;
  report.participantContactEAs = participantContactEAs;
  report.referenceTypes = refTypeCounts;

  // ---- verify pass: per-account count + cents-exact sum parity ----
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
  report.perAccount = perAccount;

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

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
