/**
 * S1 → S2 migration: employer policy history (backfill for "Unknown policy").
 *
 * S2 derives an election's policy from the EMPLOYER (resolveEmployerPolicyAsOf:
 * employer_policy_history → employers.denorm_policy_id → policy_default) —
 * elections store policy_id=NULL by design. Nothing in the earlier waves
 * populates employer policy history, so every migrated election renders
 * "Unknown policy" until this loader runs.
 *
 * S1 source (confirmed on prod MariaDB 2026-08-09): the shop node's
 * field_sirius_json blob carries the Policy tab's data —
 *   { "ledger": { "policy": {
 *       "ebh": [ { "policy": "<S1 policy nid>", "date": "YYYY-MM-DD" }, ... ],
 *       "nid": "<current S1 policy nid>" } } }
 * `ebh` is the effective-by-history table shown in the S1 employer UI
 * ("Policy" / "Effective From"); `nid` is the currently-effective policy.
 * The shop bundle has NO policy entity-reference field
 * (field_data_field_sirius_trust_policy is elections-only, verified by bundle
 * census), and prod shows 248 shops carrying ledger.policy JSON.
 *
 * What this loader does per staged grievance_shop row:
 *   1. Parse field_sirius_json → ledger.policy (absent → counted, not a reject).
 *   2. Resolve shop nid → S2 employer (id_map "employer") and every ebh
 *      policy nid → S2 policy (id_map "policy", written by load-policies).
 *   3. Validate the WHOLE shop first (any bad entry rejects the whole shop —
 *      never a partial history that would sync a wrong denorm_policy_id).
 *   4. TRUE DIFF against employer_policy_history (Task 293 sync): create
 *      missing (date, policyId) rows, DELETE migration-owned rows whose pair
 *      vanished from the S1 blob (storage auto-resyncs denorm_policy_id on
 *      both). Foreign (operator-entered) rows are never deleted; identical
 *      foreign pairs are adopted.
 *   5. Verify denorm_policy_id landed (and matches the S1 current nid when
 *      one is present).
 *
 * Sync semantics (Task 293 — RUNBOOK §10): RECONCILING.
 *   - Anchor id_map entity `employer-policy` (s1_id = shop nid, s2_id =
 *     employer id) — written only after a shop's history loaded cleanly, so
 *     rejected shops re-validate every run until fixed or ruled.
 *   - Consumed fingerprint = targeted hash of the EXTRACTED policy block plus
 *     each entry's policy-resolution outcome — a rate edit elsewhere in the
 *     shop JSON does NOT reprocess this loader, but a policy nid that becomes
 *     resolvable (load-policies re-run) does. Staged NULL content hash is
 *     irrelevant here (the hash is computed from the block, not the node).
 *   - Unchanged shops skip via the fingerprint fast path (no storage reads).
 *   - Deletion sweep: a shop whose ledger.policy block VANISHED (or whose
 *     node was deleted in S1) has its migration-owned history rows deleted
 *     (denorm auto-resyncs; operator rows survive). Shops with unparseable
 *     JSON are kept in the source set — never sweep over a parse failure.
 *
 * Ordering: AFTER load-employers (employer id_map) and load-policies (policy
 * id_map). Elections need no rerun — policy resolution is derived at read
 * time.
 *
 * Reject classes (ALL fatal for the shop — must be explicitly allowed per
 * run via --allow-rejects):
 *   bad_json                 — field_sirius_json present but unparseable
 *   shop_unmapped            — shop nid has no (non-stub) employer id_map row
 *   policy_unmapped          — an ebh policy nid has no (non-stub) policy id_map row
 *   bad_date                 — an ebh date is not a valid YYYY-MM-DD
 *   current_without_history  — ledger.policy.nid set but ebh empty (no
 *                              effective date exists to write — needs a ruling)
 *   current_mismatch         — ledger.policy.nid differs from the latest ebh
 *                              entry (S1 self-inconsistent — needs a ruling)
 *   history_create_failed    — storage write failed (sanitized code only)
 *   history_delete_failed    — reconcile delete failed (sanitized code only)
 *
 * Output is AGGREGATES ONLY — safe inside the HIPAA boundary (nids are node
 * ids, consistent with the other loaders' reject samples).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-employer-policies.ts [--dry-run]
 *       [--force-reconcile] [--allow-rejects a,b] [--allow-findings k1,k2]
 */
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { runInTransaction } from "../../server/storage/transaction-context";
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
const LOADER = "t-employer-policies";
const ID_MAP_ENTITY = "employer-policy";
/** BUMP whenever transform logic changes so unchanged S1 rows reprocess. */
const LOGIC_VERSION = 1;
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

/** Every reject is whole-shop fatal — advance/verify skip exactly these. */
const FATAL_REASONS = [
  "bad_json",
  "shop_unmapped",
  "policy_unmapped",
  "bad_date",
  "current_without_history",
  "current_mismatch",
  "history_create_failed",
  "history_delete_failed",
] as const;

interface EbhEntry {
  s1PolicyNid: number;
  date: string; // validated YYYY-MM-DD
}

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

/** The row that syncEmployerCurrentPolicy would pick as "current": max
 * (date, createdAt NULLS LAST, id) — same ordering as the storage query.
 * (uuid text compare matches Postgres uuid byte order for canonical hex.) */
function winnerOf<T extends { id: string; date: string; policyId: string; createdAt?: unknown; data?: unknown }>(
  history: T[],
): T | null {
  if (history.length === 0) return null;
  return [...history].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ac = a.createdAt ? new Date(a.createdAt as any).getTime() : -Infinity;
    const bc = b.createdAt ? new Date(b.createdAt as any).getTime() : -Infinity;
    if (ac !== bc) return ac < bc ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  })[0];
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

  const shops = await loadStaged("grievance_shop");
  report.shopsStaged = shops.length;

  // ── Pass 1: parse + collect every shop's policy block ────────────────────
  type ShopPolicy = {
    nid: number;
    entries: Array<{ s1PolicyNid: number; rawDate: unknown }>;
    currentS1Nid: number | null;
  };
  const withPolicy: ShopPolicy[] = [];
  /** Sweep source set: every shop that still CARRIES a policy block — plus
   * unparseable-JSON shops (never sweep over a parse failure). */
  const sourceNids = new Set<number>();
  let shopsWithJson = 0;
  let shopsWithoutPolicy = 0;

  for (const s of shops) {
    const { json, present, parseError } = parseShopJson(s.fields);
    if (!present) continue;
    shopsWithJson++;
    if (parseError) {
      rejects.add("bad_json", { nid: s.nid }, s.nid);
      sourceNids.add(s.nid); // unparseable ≠ removed — keep
      continue;
    }
    const pol = (json as any)?.ledger?.policy;
    if (pol == null || typeof pol !== "object") {
      shopsWithoutPolicy++;
      continue;
    }
    sourceNids.add(s.nid);
    const ebhRaw = Array.isArray((pol as any).ebh) ? ((pol as any).ebh as unknown[]) : [];
    const entries: Array<{ s1PolicyNid: number; rawDate: unknown }> = [];
    for (const e of ebhRaw) {
      const nidStr = String((e as any)?.policy ?? "").trim();
      const s1PolicyNid = /^\d+$/.test(nidStr) ? Number(nidStr) : NaN;
      entries.push({ s1PolicyNid, rawDate: (e as any)?.date });
    }
    const curStr = String((pol as any).nid ?? "").trim();
    const currentS1Nid = /^\d+$/.test(curStr) ? Number(curStr) : null;
    withPolicy.push({ nid: s.nid, entries, currentS1Nid });
  }
  report.shopsWithJson = shopsWithJson;
  report.shopsWithPolicy = withPolicy.length;
  report.shopsWithoutPolicy = shopsWithoutPolicy;

  // ── Batched id_map resolution ─────────────────────────────────────────────
  const employerMap = await getMappings("employer", withPolicy.map((s) => s.nid));
  const anchorMap = await getMappings(ID_MAP_ENTITY, withPolicy.map((s) => s.nid));
  const allPolicyNids = [
    ...new Set(
      withPolicy.flatMap((s) => [
        ...s.entries.map((e) => e.s1PolicyNid).filter((n) => Number.isFinite(n)),
        ...(s.currentS1Nid != null ? [s.currentS1Nid] : []),
      ]),
    ),
  ];
  const policyMap = await getMappings("policy", allPolicyNids);
  report.distinctS1PolicyNids = allPolicyNids.length;

  // ── Pass 2: classify, validate whole-shop, then diff + write ─────────────
  progress.phase(null);
  progress.setTotal(withPolicy.length);
  let created = 0;
  let adopted = 0;
  let removed = 0;
  let employersTouched = 0;
  let denormRepaired = 0;
  const okShops: Array<{ nid: number; employerId: string; expectedCurrentPolicyId: string | null; isNew: boolean }> = [];

  for (const shop of withPolicy) {
    progress.add(1);
    const emp = employerMap.get(shop.nid);
    if (!emp || emp.stub) {
      rejects.add("shop_unmapped", { nid: shop.nid, stub: emp?.stub ?? false }, shop.nid);
      continue;
    }

    // Consumed fingerprint = the extracted block + each entry's resolution
    // outcome (computed BEFORE validation so unchanged-but-broken shops
    // classify identically each run — but broken shops never get a mapping,
    // so they re-validate until fixed or ruled anyway).
    const fp = contentHashOf({
      entries: shop.entries.map((e) => ({
        nid: Number.isFinite(e.s1PolicyNid) ? e.s1PolicyNid : String(e.s1PolicyNid),
        date: e.rawDate ?? null,
        s2: Number.isFinite(e.s1PolicyNid)
          ? (() => {
              const m = policyMap.get(e.s1PolicyNid);
              return m && !m.stub ? m.s2Id : "unresolved";
            })()
          : "unresolved",
      })),
      current: shop.currentS1Nid,
      employer: emp.s2Id,
    });
    const mapping = anchorMap.get(shop.nid);
    if (classifyRow(mapping, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }

    // Validate every entry before writing anything for this shop.
    const valid: EbhEntry[] = [];
    let shopRejected = false;
    for (const e of shop.entries) {
      if (!Number.isFinite(e.s1PolicyNid) || !policyMap.get(e.s1PolicyNid) || policyMap.get(e.s1PolicyNid)!.stub) {
        rejects.add("policy_unmapped", { nid: shop.nid, s1PolicyNid: e.s1PolicyNid }, shop.nid);
        shopRejected = true;
        continue;
      }
      const ymd = typeof e.rawDate === "string" ? toYmd(e.rawDate) : null;
      if (!ymd) {
        rejects.add("bad_date", { nid: shop.nid, s1PolicyNid: e.s1PolicyNid }, shop.nid);
        shopRejected = true;
        continue;
      }
      valid.push({ s1PolicyNid: e.s1PolicyNid, date: ymd });
    }

    // Current-policy consistency: the S1 UI derives "current" from the same
    // history, so a mismatch means S1 is self-inconsistent — rule, don't guess.
    if (!shopRejected && shop.currentS1Nid != null) {
      if (valid.length === 0) {
        rejects.add("current_without_history", { nid: shop.nid, s1PolicyNid: shop.currentS1Nid }, shop.nid);
        shopRejected = true;
      } else {
        const latest = valid.reduce((a, b) => (b.date >= a.date ? b : a));
        if (latest.s1PolicyNid !== shop.currentS1Nid) {
          rejects.add(
            "current_mismatch",
            { nid: shop.nid, currentS1Nid: shop.currentS1Nid, latestEbhNid: latest.s1PolicyNid },
            shop.nid,
          );
          shopRejected = true;
        }
      }
    }
    // A mapped shop whose block became EMPTY of valid entries but still has a
    // policy object is unusual (ebh cleared by hand) — reconcile to the empty
    // owned set rather than skipping, so S1-removed rows disappear.
    if (shopRejected) continue;
    if (valid.length === 0 && !mapping) continue; // nothing to load, nothing owned

    // Dedupe identical (date, policy) pairs within the S1 blob itself.
    const seen = new Set<string>();
    const entries = valid.filter((e) => {
      const k = `${e.date}|${e.s1PolicyNid}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const expectedCurrent = entries.length > 0 ? entries.reduce((a, b) => (b.date >= a.date ? b : a)) : null;
    const expectedCurrentPolicyId = expectedCurrent ? policyMap.get(expectedCurrent.s1PolicyNid)!.s2Id : null;

    if (DRY_RUN) {
      created += entries.length;
      if (mapping) summary.updated++; // approximate under --dry-run
      else summary.created++;
      okShops.push({ nid: shop.nid, employerId: emp.s2Id, expectedCurrentPolicyId, isNew: !mapping });
      continue;
    }

    try {
      const existing = await storage.employerPolicyHistory.getEmployerPolicyHistory(emp.s2Id);
      const existingKeys = new Set(existing.map((r: any) => `${r.date}|${r.policyId}`));
      const desiredKeys = new Set(entries.map((e) => `${e.date}|${policyMap.get(e.s1PolicyNid)!.s2Id}`));
      const toCreate = entries.filter((e) => !existingKeys.has(`${e.date}|${policyMap.get(e.s1PolicyNid)!.s2Id}`));
      // Reconcile deletes: migration-owned rows whose (date, policyId) pair
      // vanished from the S1 blob. Foreign rows are NEVER deleted.
      const toDelete = (existing as any[]).filter(
        (r) => (r.data as any)?.source === "s1-migration" && !desiredKeys.has(`${r.date}|${r.policyId}`),
      );
      adopted += entries.length - toCreate.length;

      if (toCreate.length > 0 || toDelete.length > 0) {
        // One transaction per shop: either ALL of this shop's adds+removes
        // land (and the denorm sync sees the complete history) or none do — a
        // mid-shop failure must never leave a partial history driving
        // denorm_policy_id.
        await withNotificationsSuppressed(() =>
          runInTransaction(async () => {
            for (const e of toCreate) {
              await storage.employerPolicyHistory.createEmployerPolicyHistory({
                employerId: emp.s2Id,
                date: e.date,
                policyId: policyMap.get(e.s1PolicyNid)!.s2Id,
                data: { source: "s1-migration", s1ShopNid: shop.nid, s1PolicyNid: e.s1PolicyNid },
              });
            }
            for (const r of toDelete) {
              const ok = await storage.employerPolicyHistory.deleteEmployerPolicyHistory(r.id);
              if (!ok) throw new Error("history_delete_failed");
            }
          }),
        );
        created += toCreate.length;
        removed += toDelete.length;
        employersTouched++;
        if (mapping) summary.updated++;
        else summary.created++;
      } else {
        // Adopt-only rerun: rows already exist, but a past crash between
        // insert-commit and denorm sync (or a manual edit) can leave
        // denorm_policy_id stale. Reconcile — only when a migration-owned row
        // is the rightful winner (foreign winners belong to S2 operators).
        const winner = winnerOf(existing as any[]);
        let repaired = false;
        if (winner && (winner.data as any)?.source === "s1-migration") {
          const empRow = await storage.employers.getEmployer(emp.s2Id);
          if (empRow && (((empRow as any).denormPolicyId ?? null) !== winner.policyId)) {
            await withNotificationsSuppressed(() => storage.employers.updateEmployerPolicy(emp.s2Id, winner.policyId));
            denormRepaired++;
            repaired = true;
          }
        }
        if (mapping) {
          if (repaired) summary.updated++;
          else summary.unchanged++;
        } else {
          summary.created++; // first mapping over pre-existing rows (adopt)
        }
      }

      if (!mapping) {
        await putMapping(ID_MAP_ENTITY, shop.nid, emp.s2Id, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
      } else {
        pendingAdvance.push({ s1Id: shop.nid, fingerprint: fp });
      }
      okShops.push({ nid: shop.nid, employerId: emp.s2Id, expectedCurrentPolicyId, isNew: !mapping });
    } catch (err) {
      // Sanitized: class/code only — never raw error text (HIPAA boundary).
      const code = err instanceof Error ? err.constructor.name : "unknown";
      if (err instanceof Error && err.message === "history_delete_failed") {
        rejects.add("history_delete_failed", { nid: shop.nid }, shop.nid);
      } else {
        rejects.add("history_create_failed", { nid: shop.nid, code }, shop.nid);
      }
    }
  }

  report.historyCreated = created;
  report.historyAdopted = adopted;
  report.historyRemoved = removed;
  report.employersTouched = employersTouched;
  report.denormRepaired = denormRepaired;
  report.fastPathSkips = fastPathSkips;

  // ── Verify: denorm_policy_id synced for every ok shop ─────────────────────
  let verifyFailures = 0;
  if (!DRY_RUN) {
    progress.phase("verify", okShops.length);
    for (const ok of okShops) {
      progress.add(1);
      const emp = await storage.employers.getEmployer(ok.employerId);
      if (!emp) {
        console.error(`VERIFY: shop nid ${ok.nid} maps to missing employer ${ok.employerId}`);
        verifyFailures++;
        verifyFailedNids.add(ok.nid);
        continue;
      }
      const denorm = (emp as any).denormPolicyId ?? null;
      const history = await storage.employerPolicyHistory.getEmployerPolicyHistory(ok.employerId);
      const winner = winnerOf(history as any[]);
      if (!winner) {
        // an all-owned history reconciled away is legal only when S1 says so
        if (ok.expectedCurrentPolicyId != null) {
          console.error(`VERIFY: shop nid ${ok.nid} employer has no policy history after load`);
          verifyFailures++;
          verifyFailedNids.add(ok.nid);
        }
        continue;
      }
      // denorm must equal the row the storage ordering actually picks —
      // whether that row is ours or a legitimately-later foreign S2 row.
      if (denorm !== winner.policyId) {
        console.error(`VERIFY: shop nid ${ok.nid} denorm_policy_id != winning history row`);
        verifyFailures++;
        verifyFailedNids.add(ok.nid);
        continue;
      }
      // And when a migration row wins, it must be the S1 latest-ebh policy.
      if (
        (winner.data as any)?.source === "s1-migration" &&
        ok.expectedCurrentPolicyId != null &&
        winner.policyId !== ok.expectedCurrentPolicyId
      ) {
        console.error(`VERIFY: shop nid ${ok.nid} winning migration row != latest S1 ebh policy`);
        verifyFailures++;
        verifyFailedNids.add(ok.nid);
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — post-verify ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      ID_MAP_ENTITY,
      pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id) && !rejects.hasAnyIn(p.s1Id, FATAL_REASONS)),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweep: shops whose policy block vanished (or node deleted) ----
  // Migration-owned history rows are SAFE CHILD ROWS: deleted (denorm
  // auto-resyncs per delete); operator-entered rows always survive.
  const sweep = await sweepDeletions({
    entity: ID_MAP_ENTITY,
    loaders: [LOADER],
    sourceIds: sourceNids,
    dryRun: DRY_RUN,
    policy: async (c) => ({
      action: "delete",
      apply: async () => {
        const rows = await storage.employerPolicyHistory.getEmployerPolicyHistory(c.s2Id);
        for (const r of rows as any[]) {
          if ((r.data as any)?.source !== "s1-migration") continue;
          await withNotificationsSuppressed(() => storage.employerPolicyHistory.deleteEmployerPolicyHistory(r.id));
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
