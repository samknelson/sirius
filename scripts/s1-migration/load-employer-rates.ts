/**
 * S1 → S2 migration: per-employer hourly rate history → sitespecific_bao_employer_rates.
 *
 * Why: S2's hourly billing (bao-hourly charge plugin + monthly-hours wizard)
 * looks rates up from sitespecific_bao_employer_rates (per employer, per
 * ledger account, effective-dated). Nothing else populates it — without this
 * loader every post-cutover hours row logs "no effective rate — skipping"
 * and silently creates NO charge.
 *
 * S1 source (confirmed on prod MariaDB 2026-08-09): the shop node's
 * field_sirius_json blob carries per-employer rate schedules keyed by S1
 * charge-plugin-instance uuid —
 *   { "charge_plugins": { "settings": {
 *       "<uuid>": { "rates": { "history": [
 *           { "rate": "6.50", "date": "2025-07-01", "ts": 1751353200 }, ... ] } } } } }
 * Future-dated entries (negotiated increases out to 2028) are real and must
 * import as-is — getEffectiveRate selects as-of the work date.
 *
 * Which uuids are HOURLY (the ruling, derived empirically 2026-08-09 by
 * reconciling every per-shop JSON entry against the S1 UI rate-history report
 * export — 679 rows / 131 employers, every report row accounted for):
 *   - The uuid → plugin-type definitions live on POLICY nodes
 *     (sirius_json_definition → charge_plugins.items). Older instance
 *     generations were deleted/recreated over time; shop settings keep rate
 *     history under the ORPHANED old uuids, so the allow-list must include
 *     them, in precedence order (earlier wins a same-date cross-uuid tie —
 *     validated against the report's own winners):
 *       54a9b912… (Health Fund hourly, dominant orphan generation)
 *       8a1da7c9… ("Hourly Employers" / hourly_by_employer — the LIVE item)
 *       0f5c5277… (older orphan generation)
 *       dbf243fa… (older orphan generation)
 *       e367c62c… ("Hourly Employer Contributions" / plugin "hourly", other
 *                  policy family — report includes it; loses same-date ties)
 *   - EXCLUDED (monthly-type instances, absent from the rate report):
 *     029b60bf…, 13c01f95… (Monthly Kaiser), 059a34c0…, d1a35aeb…, and any
 *     unknown uuid (counted, never imported).
 *
 * Target account: the ONE enabled bao-hourly charge config's account
 * (fund config: "BAO Hourly" → Health Fund - Employer Contributions).
 * Resolved at runtime from plugin_configs + charge subsidiary — the loader
 * aborts unless exactly one enabled bao-hourly config exists, because that
 * config's account is precisely where getEffectiveRate will look.
 *
 * Per staged grievance_shop row:
 *   1. Parse field_sirius_json → charge_plugins.settings (absent → counted).
 *   2. Collect history entries from allow-listed uuids; validate date + rate.
 *   3. Winner per (shop, effective date): uuid precedence (counted when it
 *      actually resolves a differing-rate tie). Identical duplicates dedupe
 *      silently. Same-uuid same-date differing rates = S1 self-inconsistent →
 *      whole-shop reject (rule/fix in S1, never guess a rate).
 *   4. Resolve shop nid → S2 employer (id_map "employer"; stubs unmapped).
 *   5. TRUE DIFF (Task 293 sync) via storage.baoEmployerRates — missing rows
 *      create, migration-owned rows with drifted rates update, migration-
 *      owned rows whose effective DATE vanished from S1 delete; foreign
 *      (operator-entered) rows are NEVER overwritten (reject) or deleted.
 *   6. Verify: re-read every ok shop's rows — each winning (date, rate)
 *      present with a numerically equal rate AND no stale migration-owned
 *      date remains.
 *
 * Sync semantics (Task 293 — RUNBOOK §10): RECONCILING.
 *   - Anchor id_map entity `employer-rate` (s1_id = shop nid, s2_id =
 *     employer id) — written after a shop's rates loaded cleanly.
 *   - Consumed fingerprint = targeted hash of the WINNING entries
 *     ({date, rate, uuid}, date-sorted) — a policy edit elsewhere in the
 *     shop JSON does not reprocess this loader.
 *   - Unchanged shops skip via the fingerprint fast path (no storage reads).
 *   - Deletion sweep: a shop whose hourly rate history VANISHED (or whose
 *     node was deleted in S1) has its migration-owned rate rows deleted.
 *     Unparseable JSON keeps the shop in the source set — never sweep over a
 *     parse failure.
 *
 * Ordering: AFTER load-employers (employer id_map) and after fund config
 * exists (copy-fund-config — provides the bao-hourly config + account).
 *
 * Reject classes (fatal unless explicitly allowed via --allow-rejects):
 *   bad_json             — field_sirius_json present but unparseable (whole shop)
 *   shop_unmapped        — no (non-stub) employer id_map row (whole shop)
 *   bad_date             — entry date not a valid YYYY-MM-DD (entry skipped)
 *   bad_rate             — entry rate not a plain decimal (entry skipped; prod
 *                          has known colon typos "6:00"/"6:75", both cleanly
 *                          re-entered under another uuid — verified vs report)
 *   rate_conflict        — same uuid, same date, different rates (whole shop;
 *                          known: 1 prod shop — fix in S1 or allow explicitly)
 *   rate_exists_foreign  — a non-migration row occupies (employer, account,
 *                          date) with a different rate (entry skipped)
 *   rate_write_failed    — storage write failed (sanitized code only; whole shop)
 *   rate_delete_failed   — reconcile delete failed (sanitized code only; whole shop)
 *
 * Output is AGGREGATES ONLY — safe inside the HIPAA boundary (nids are node
 * ids, rates are employer billing config, consistent with sibling loaders).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-employer-rates.ts [--dry-run]
 *       [--force-reconcile] [--allow-rejects a,b] [--allow-findings k1,k2]
 */
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints } from "./lib/idmap";
import { RejectLog, loadStaged, toYmd, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  contentHashOf,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
} from "./lib/sync";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t-employer-rates";
const ID_MAP_ENTITY = "employer-rate";
/** BUMP whenever transform logic changes so unchanged S1 rows reprocess. */
const LOGIC_VERSION = 1;
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

/** Whole-shop fatal reasons — advance/verify skip exactly these. Entry-level
 * annotations (bad_date/bad_rate/rate_exists_foreign) also block advance so
 * the shop keeps reprocessing until fixed or ruled. */
const ADVANCE_BLOCKERS = [
  "bad_json",
  "shop_unmapped",
  "bad_date",
  "bad_rate",
  "rate_conflict",
  "rate_exists_foreign",
  "rate_write_failed",
  "rate_delete_failed",
] as const;

/** Hourly plugin-instance uuids, in precedence order (index 0 wins ties). */
const HOURLY_UUIDS = [
  "54a9b912-1658-4d97-934a-d31b277f33b5",
  "8a1da7c9-359a-4e3e-bb24-8e4809dcef43",
  "0f5c5277-1f9c-4d40-8e92-d36c558143a1",
  "dbf243fa-5e7b-4844-b1c7-7a2de1d16e1a",
  "e367c62c-0933-4c8f-8b4f-0bb34ef3e1ea",
];
const HOURLY_RANK = new Map(HOURLY_UUIDS.map((u, i) => [u, i]));

function parseShopJson(fields: Record<string, unknown>): { json: unknown; present: boolean; parseError: boolean } {
  // Production stages field_sirius_json as an object ({value, ...}); tolerate
  // a scalar-staged shape too (same tolerance as load-hours).
  const raw = fields["field_sirius_json"] as { value?: unknown } | string | undefined;
  let v: unknown = typeof raw === "object" && raw !== null && "value" in raw ? raw.value : raw;
  if (v == null) return { json: null, present: false, parseError: false };
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { json: null, present: true, parseError: true };
    }
  }
  return { json: v, present: true, parseError: false };
}

/** Strict decimal parse — rejects the known S1 colon typos ("6:75") rather
 * than guessing; those rows were re-entered cleanly under another uuid. */
function parseRate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4);
}

/** The single enabled bao-hourly charge config's account — where
 * getEffectiveRate will actually look. Aborts on 0 or >1 configs. */
async function resolveHourlyAccount(): Promise<{ accountId: string; configName: string | null }> {
  const envelopes = await storage.pluginConfigs.search("charge", { pluginId: "bao-hourly", enabled: true });
  if (envelopes.length !== 1) {
    console.error(
      `FAIL: expected exactly 1 enabled bao-hourly charge config, found ${envelopes.length}. ` +
        `The loader targets that config's account. Charge configs are FUND CONFIG — no loader creates ` +
        `them; configure the bao-hourly charge config (global scope, employer-contributions account) ` +
        `on the target first, or resolve duplicates.`,
    );
    process.exit(1);
  }
  const sub = envelopes[0].subsidiary as { account?: string | null } | null;
  if (!sub?.account) {
    console.error("FAIL: the enabled bao-hourly config has no account (subsidiary row missing?).");
    process.exit(1);
  }
  return { accountId: sub.account, configName: envelopes[0].config.name ?? null };
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  throttleStorageOpLogs();

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();
  const summary = emptySummary();
  let fastPathSkips = 0;
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const verifyFailedNids = new Set<number>();
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const { accountId, configName } = await resolveHourlyAccount();
  report.accountId = accountId;
  report.chargeConfigName = configName;

  const shops = await loadStaged("grievance_shop");
  report.shopsStaged = shops.length;

  // ── Pass 1: parse + collect winning entries per shop ─────────────────────
  type ShopRates = {
    nid: number;
    // winner per effective date
    entries: Array<{ date: string; rate: string; uuid: string; ts: unknown }>;
  };
  const withRates: ShopRates[] = [];
  /** Sweep source set: every shop that still CARRIES hourly rate history —
   * plus unparseable/conflicted shops (never sweep over a parse failure). */
  const sourceNids = new Set<number>();
  let shopsWithJson = 0;
  let shopsWithoutRates = 0;
  let entriesSeen = 0;
  let entriesNonHourly = 0;
  let entriesDeduped = 0;
  let tiesResolvedByPrecedence = 0;

  for (const s of shops) {
    const { json, present, parseError } = parseShopJson(s.fields);
    if (!present) continue;
    shopsWithJson++;
    if (parseError) {
      rejects.add("bad_json", { nid: s.nid }, s.nid);
      sourceNids.add(s.nid); // unparseable ≠ removed — keep
      continue;
    }
    const settings = (json as any)?.charge_plugins?.settings;
    if (settings == null || typeof settings !== "object") {
      shopsWithoutRates++;
      continue;
    }

    let shopRejected = false;
    // date → winning entry (lowest rank). Same-rank same-date different-rate
    // is S1 self-inconsistency → whole-shop reject.
    const byDate = new Map<string, { rank: number; date: string; rate: string; uuid: string; ts: unknown }>();
    let sawAny = false;

    for (const [uuid, cfgRaw] of Object.entries(settings as Record<string, unknown>)) {
      let cfg: unknown = cfgRaw;
      if (typeof cfg === "string") {
        try {
          cfg = JSON.parse(cfg);
        } catch {
          rejects.add("bad_json", { nid: s.nid, uuid }, s.nid);
          shopRejected = true;
          continue;
        }
      }
      const history = (cfg as any)?.rates?.history;
      if (!Array.isArray(history) || history.length === 0) continue;
      const rank = HOURLY_RANK.get(uuid);
      if (rank === undefined) {
        entriesNonHourly += history.length;
        continue;
      }
      for (const h of history) {
        entriesSeen++;
        sawAny = true;
        const ymd = typeof (h as any)?.date === "string" ? toYmd((h as any).date) : null;
        if (!ymd) {
          rejects.add("bad_date", { nid: s.nid, uuid, date: String((h as any)?.date) }, s.nid);
          continue;
        }
        const rate = parseRate((h as any)?.rate);
        if (rate == null) {
          rejects.add("bad_rate", { nid: s.nid, uuid, date: ymd }, s.nid);
          continue;
        }
        const cur = byDate.get(ymd);
        if (!cur) {
          byDate.set(ymd, { rank, date: ymd, rate, uuid, ts: (h as any)?.ts ?? null });
        } else if (cur.rate === rate) {
          entriesDeduped++;
        } else if (cur.rank === rank) {
          // Same instance, same date, different rates — never guess.
          rejects.add("rate_conflict", { nid: s.nid, uuid, date: ymd }, s.nid);
          shopRejected = true;
        } else if (rank < cur.rank) {
          byDate.set(ymd, { rank, date: ymd, rate, uuid, ts: (h as any)?.ts ?? null });
          tiesResolvedByPrecedence++;
        } else {
          tiesResolvedByPrecedence++;
        }
      }
    }

    if (sawAny || shopRejected) sourceNids.add(s.nid);
    if (shopRejected) continue;
    if (!sawAny) {
      shopsWithoutRates++;
      continue;
    }
    const entries = [...byDate.values()]
      .map(({ date, rate, uuid, ts }) => ({ date, rate, uuid, ts }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    if (entries.length > 0) withRates.push({ nid: s.nid, entries });
  }
  report.shopsWithJson = shopsWithJson;
  report.shopsWithRates = withRates.length;
  report.shopsWithoutRates = shopsWithoutRates;
  report.entriesSeen = entriesSeen;
  report.entriesNonHourlySkipped = entriesNonHourly;
  report.entriesDeduped = entriesDeduped;
  report.tiesResolvedByPrecedence = tiesResolvedByPrecedence;

  // ── Batched employer + anchor resolution ─────────────────────────────────
  const employerMap = await getMappings("employer", withRates.map((s) => s.nid));
  const anchorMap = await getMappings(ID_MAP_ENTITY, withRates.map((s) => s.nid));

  // ── Pass 2: classify + diff + write ──────────────────────────────────────
  progress.phase(null);
  progress.setTotal(withRates.length);
  let created = 0;
  let updated = 0;
  let adopted = 0;
  let removed = 0;
  const perYear: Record<string, number> = {};
  const okShops: Array<{
    nid: number;
    employerId: string;
    entries: Array<{ date: string; rate: string }>;
    desiredDates: Set<string>;
  }> = [];

  for (const shop of withRates) {
    progress.add(1);
    const emp = employerMap.get(shop.nid);
    if (!emp || emp.stub) {
      rejects.add("shop_unmapped", { nid: shop.nid, stub: emp?.stub ?? false }, shop.nid);
      continue;
    }

    // Consumed fingerprint = the winning entries only (ts excluded — it is
    // provenance metadata, not billing content).
    const fp = contentHashOf({
      employer: emp.s2Id,
      entries: shop.entries.map((e) => ({ date: e.date, rate: e.rate, uuid: e.uuid })),
    });
    const mapping = anchorMap.get(shop.nid);
    if (classifyRow(mapping, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }

    for (const e of shop.entries) perYear[e.date.slice(0, 4)] = (perYear[e.date.slice(0, 4)] ?? 0) + 1;

    if (DRY_RUN) {
      created += shop.entries.length;
      if (mapping) summary.updated++; // approximate under --dry-run
      else summary.created++;
      okShops.push({ nid: shop.nid, employerId: emp.s2Id, entries: shop.entries, desiredDates: new Set(shop.entries.map((e) => e.date)) });
      continue;
    }

    try {
      const existing = await storage.baoEmployerRates.list({ employerId: emp.s2Id, accountId });
      const byYmd = new Map(existing.map((r) => [r.effectiveYmd, r]));
      const desiredDates = new Set(shop.entries.map((e) => e.date));
      const toWrite: Array<{ date: string; rate: string; uuid: string; ts: unknown; isUpdate: boolean }> = [];
      let entryRejected = false;

      for (const e of shop.entries) {
        const cur = byYmd.get(e.date);
        if (!cur) {
          toWrite.push({ ...e, isUpdate: false });
          continue;
        }
        if (Number(cur.rate) === Number(e.rate)) {
          adopted++;
          continue;
        }
        if ((cur.data as any)?.source === "s1-migration") {
          toWrite.push({ ...e, isUpdate: true });
        } else {
          // An operator-entered row occupies this slot with a different rate —
          // it belongs to S2 operations, never overwrite it from migration.
          rejects.add("rate_exists_foreign", { nid: shop.nid, date: e.date }, shop.nid);
          entryRejected = true;
        }
      }

      // Reconcile deletes: migration-owned rows whose effective DATE vanished
      // from the S1 winners. Foreign rows are never deleted.
      const toDelete = existing.filter(
        (r) => (r.data as any)?.source === "s1-migration" && !desiredDates.has(r.effectiveYmd),
      );

      if (toWrite.length > 0) {
        await withNotificationsSuppressed(() =>
          storage.baoEmployerRates.bulkUpsert(
            toWrite.map((e) => ({
              employerId: emp.s2Id,
              accountId,
              rate: e.rate,
              effectiveYmd: e.date,
              sourceId: null,
              data: { source: "s1-migration", s1ShopNid: shop.nid, s1PluginUuid: e.uuid, s1Ts: e.ts },
            })),
          ),
        );
        created += toWrite.filter((e) => !e.isUpdate).length;
        updated += toWrite.filter((e) => e.isUpdate).length;
      }
      for (const r of toDelete) {
        const ok = await withNotificationsSuppressed(() => storage.baoEmployerRates.delete(r.id));
        if (!ok) {
          rejects.add("rate_delete_failed", { nid: shop.nid, date: r.effectiveYmd }, shop.nid);
        } else {
          removed++;
        }
      }

      const wrote = toWrite.length > 0 || toDelete.length > 0;
      if (mapping) {
        if (wrote) summary.updated++;
        else summary.unchanged++;
      } else {
        summary.created++;
        await putMapping(ID_MAP_ENTITY, shop.nid, emp.s2Id, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
      }
      if (mapping) pendingAdvance.push({ s1Id: shop.nid, fingerprint: fp });

      // Foreign-occupied slots stay foreign; verify checks only our own rows.
      okShops.push({
        nid: shop.nid,
        employerId: emp.s2Id,
        entries: entryRejected
          ? shop.entries.filter((e) => {
              const cur = byYmd.get(e.date);
              return !cur || Number(cur.rate) === Number(e.rate) || (cur.data as any)?.source === "s1-migration";
            })
          : shop.entries,
        desiredDates,
      });
    } catch (err) {
      // Sanitized: class/code only — never raw error text (HIPAA boundary).
      const code = err instanceof Error ? err.constructor.name : "unknown";
      rejects.add("rate_write_failed", { nid: shop.nid, code }, shop.nid);
    }
  }

  report.ratesCreated = created;
  report.ratesUpdated = updated;
  report.ratesAdopted = adopted;
  report.ratesRemoved = removed;
  report.employersLoaded = okShops.length;
  report.entriesPerYear = perYear;
  report.fastPathSkips = fastPathSkips;

  // ── Verify: every winning entry present with a numerically equal rate,
  //    and no stale migration-owned date remains ────────────────────────────
  let verifyFailures = 0;
  if (!DRY_RUN) {
    progress.phase("verify", okShops.length);
    for (const ok of okShops) {
      progress.add(1);
      const rows = await storage.baoEmployerRates.list({ employerId: ok.employerId, accountId });
      const byYmd = new Map(rows.map((r) => [r.effectiveYmd, r]));
      for (const e of ok.entries) {
        const row = byYmd.get(e.date);
        if (!row || Number(row.rate) !== Number(e.rate)) {
          console.error(`VERIFY: shop nid ${ok.nid} missing/mismatched rate row for ${e.date}`);
          verifyFailures++;
          verifyFailedNids.add(ok.nid);
        }
      }
      for (const r of rows) {
        if ((r.data as any)?.source === "s1-migration" && !ok.desiredDates.has(r.effectiveYmd)) {
          console.error(`VERIFY: shop nid ${ok.nid} stale migration-owned rate row remains for ${r.effectiveYmd}`);
          verifyFailures++;
          verifyFailedNids.add(ok.nid);
        }
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — post-verify ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      ID_MAP_ENTITY,
      pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id) && !rejects.hasAnyIn(p.s1Id, ADVANCE_BLOCKERS)),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweep: shops whose hourly history vanished (or node deleted) ----
  // Migration-owned rate rows are SAFE CHILD ROWS: deleted; operator rows
  // always survive.
  const sweep = await sweepDeletions({
    entity: ID_MAP_ENTITY,
    loaders: [LOADER],
    sourceIds: sourceNids,
    dryRun: DRY_RUN,
    policy: async (c) => ({
      action: "delete",
      apply: async () => {
        const rows = await storage.baoEmployerRates.list({ employerId: c.s2Id, accountId });
        for (const r of rows) {
          if ((r.data as any)?.source !== "s1-migration") continue;
          await withNotificationsSuppressed(() => storage.baoEmployerRates.delete(r.id));
        }
      },
    }),
  });
  summary.deleted += sweep.deleted;
  report.sweep = { candidates: sweep.candidates, deleted: sweep.deleted, alreadyHandled: sweep.alreadyHandled };

  progress.stop();
  report.rejectSamples = rejects.samples;

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
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(`FAIL: ${result.blockingFindings.length} blocking sync finding(s) — resolve or acknowledge via --allow-findings.`);
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
