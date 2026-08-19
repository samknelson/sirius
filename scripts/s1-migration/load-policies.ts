/**
 * Policies loader — maps S1 policy references onto S2's CONFIGURED `policies`
 * rows. Milestone 3 (load order: employers → policies → relationships).
 *
 * P4 RULED 2026-08-06 (N27): S1's policy bundle is `sirius_json_definition`
 * (not `sirius_trust_policy`; production census didn't list it, but the prod
 * query pack §P4 confirms 15 distinct nodes, 242,664 refs, 23 orphan refs
 * whose nodes are deleted). The synthetic dev DB has ZERO rows in the field
 * table, so the target bundle could not be determined from the snapshot.
 *
 * This loader ADOPTS, never creates:
 *   - S2 `policies` rows are configuration (they carry benefitIds config and
 *     seeded sirius_id codes). Unresolvable references HARD-FAIL before any
 *     id_map write.
 *   - Resolution per referenced nid:
 *       1. Fund-ruled S1-title alias table (N27, 2026-08-06), covering all 15
 *          S1 plan titles → S2 siriusId. Appeal variants ("UNITE HERE Plan -
 *          Kaiser Appeal" etc.) map to their base plan — exemptions replace
 *          appeals in S2 and will be entered manually post-migration.
 *       2. Direct name / siriusId match (byName fallback).
 *     → id_map entity "policy" (audit trail for T16's data.s1PolicyNid stash).
 *
 * Run seed-migration-policies.ts on every target DB first (dev DB included) —
 * it seeds/renames the full 7-policy catalogue (PA, UH, EC, COBRA, RES, TT, U;
 * R→UH rename ruling 2026-08-11).
 *
 * Deleted policy nodes → Inactive (ruling 2026-08-11): election refs whose S1
 * node was deleted (no staged sirius_json_definition row — 23 such refs in
 * prod, refs_without_node from §P4) map to the Inactive policy (sirius_id=U)
 * via id_map like any other resolution. Each absorbed nid is reported with
 * its election count in `mappedToInactive` (per-nid map, never a collapsed
 * counter — an unexpected nid must be visible). The former
 * policy_ref_not_staged reject class is retired: the fallback fully covers
 * it, and the loader aborts at startup if the Inactive policy row is absent.
 *
 * Staged sirius_json_definition rows that NO election references and that
 * match no S2 policy reject as policy_unmatched_unreferenced (the bundle is a
 * generic JSON-definition store — dev carries a non-policy "workers_v1" node;
 * allow after inspecting the reported titles). Referenced-but-unmatched is
 * always fatal.
 *
 * Elections themselves do NOT store a policy id in S2 (02 §5b — policy is
 * derived via resolveEmployerPolicyAsOf); id_map entries exist so T16 can
 * stash/audit and so employer policy setup can be cross-checked.
 *
 * Idempotent: re-run resolves via id_map, zero writes.
 *
 * Sync semantics (Task 292 — RUNBOOK §10): this loader is RECONCILING by
 * design. Mapped refs whose staged content_hash matches the consumed
 * fingerprint (same logic version) short-circuit without re-resolving;
 * CHANGED refs re-resolve and may REMAP their id_map entry onto a different
 * configured policy (S1 wins during the dual-run). Deleted-node refs keep
 * resolving to Inactive. A deletion sweep reports mapped nids that are no
 * longer staged NOR referenced by any staged election (report-only policy —
 * this loader adopts configured S2 rows; nothing is deleted without a
 * ruling; acknowledge per run via --allow-findings deleted_in_s1).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-policies.ts [--dry-run] \
 *     [--allow-rejects policy_unmatched_unreferenced] \
 *     [--force-reconcile] [--allow-findings deleted_in_s1]
 *
 * Output is AGGREGATES ONLY — safe inside the HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, advanceFingerprints, remapMapping } from "./lib/idmap";
import { RejectLog, loadStaged, targetNidOf, strOf } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type SyncFinding,
} from "./lib/sync";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t-policies";
/** Loader logic version — BUMP whenever resolution logic (alias table,
 * fallback rules) changes so mapped refs re-resolve on their next run. */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

/**
 * Fund-ruled 2026-08-06 (N27): S1 sirius_json_definition node title (lowercase)
 * → S2 policy siriusId. All 15 distinct prod targets are listed here.
 *
 * Appeal variants map to their base plan's siriusId — appeals in S1 are
 * replaced by exemptions in S2 and will be entered manually post-migration;
 * they are NOT part of the ETL.
 *
 * Titles that happen to match S2 names directly also resolve via the byName
 * fallback, but listing them here makes the complete fund ruling explicit and
 * self-documenting.
 */
const S1_TITLE_TO_SIRIUS_ID: Record<string, string> = {
  // Participation Agreement family (sirius_id=PA)
  "participation agreement": "PA",
  "participation agreement - delta appeal": "PA",
  // COBRA
  "cobra": "COBRA",
  // UNITE HERE Plan family → S2 "Unite Here Plan" (sirius_id=UH; renamed
  // from R / "Restaurant Plan" — same row — per the 2026-08-11 ruling)
  "unite here plan": "UH",
  "unite here plan - delta appeal": "UH",
  "unite here plan - kaiser appeal": "UH",
  "unite here plan - healthnet appeal": "UH",
  // Event Center family (sirius_id=EC)
  "event center plan": "EC",
  "event center plan - delta appeal": "EC",
  "event center plan - kaiser appeal": "EC",
  "event center plan - healthnet appeal": "EC",
  // Plans needing NEW S2 policies — seed-migration-policies.ts must run first
  "restaurant plan": "RES",
  "restaurant plan - delta appeal": "RES",
  "there there restaurant plan": "TT",
  "inactive": "U",
};

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();
  const summary = emptySummary();
  let fastPathSkips = 0;

  // Heartbeat: the ~243k-row staged election load below is this loader's only
  // long stretch (the resolution work after it is ~150 refs); liveness-only
  // for the whole run — aggregates only.
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  // 1) Every S1 policy reference: election field targets + any staged
  //    sirius_json_definition bundle rows (the confirmed prod bundle — P4 RULED
  //    2026-08-06). Also check sirius_trust_policy for backward compat (dev
  //    DB has the table with zero rows; prod has none by census).
  const elections = await loadStaged("sirius_trust_worker_election");
  const policyBundleRows = [
    ...(await loadStaged("sirius_trust_policy")),
    ...(await loadStaged("sirius_json_definition")),
  ];
  // Per-nid election counts feed the mappedToInactive report (ruling
  // 2026-08-11) — every deleted-node nid must surface with its election count.
  const electionRefCounts = new Map<number, number>();
  for (const e of elections) {
    const nid = targetNidOf(e.fields, "field_sirius_trust_policy");
    if (nid != null) electionRefCounts.set(nid, (electionRefCounts.get(nid) ?? 0) + 1);
  }
  const electionReferencedNids = new Set<number>(electionRefCounts.keys());
  const refNids = new Set<number>([...policyBundleRows.map((r) => r.nid), ...electionReferencedNids]);
  report.stagedElections = elections.length;
  report.stagedPolicyBundleRows = policyBundleRows.length;
  report.distinctPolicyRefs = refNids.size;

  const s2Policies = await storage.policies.getAllPolicies();
  report.s2Policies = s2Policies.length;

  // Startup precondition (ruling 2026-08-11): the Inactive policy must exist
  // BEFORE any resolution/writes — deleted-node election refs map to it.
  const inactivePolicy = s2Policies.find((p) => p.siriusId.trim().toUpperCase() === "U");
  if (!inactivePolicy) {
    console.error(
      "FAIL: Inactive policy (sirius_id=U) is missing from this target. Election refs to deleted " +
        "S1 policy nodes map to it (ruling 2026-08-11), so the loader cannot proceed without it. " +
        "Run seed-migration-policies.ts first. Nothing was written.",
    );
    process.exit(1);
  }

  if (refNids.size === 0) {
    report.note =
      "no policy references in staging (synthetic gap — prod has 242,664 refs; see 07 §P4). " +
      "Stage sirius_json_definition before running on prod.";
    progress.stop();
    emitLoaderResult(
      buildLoaderResult({
        loader: LOADER,
        logicVersion: LOGIC_VERSION,
        dryRun: DRY_RUN,
        forceReconcile: FORCE_RECONCILE,
        summary,
        rejects,
        allowedRejects: ALLOWED_REJECTS,
        verifyFailures: 0,
        detail: report,
      }),
    );
    if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);
    process.exit(0);
  }

  // 2) Resolve ALL references before writing anything (fail-loud preflight).
  const existing = await getMappings("policy", [...refNids]);

  // Build lookup maps from S2 policy rows
  const byName = new Map<string, string>();     // lowercase name or siriusId → policy row id
  const bySiriusId = new Map<string, string>(); // lowercase siriusId → policy row id
  for (const p of s2Policies) {
    if (p.name) byName.set(p.name.trim().toLowerCase(), p.id);
    byName.set(p.siriusId.trim().toLowerCase(), p.id);
    bySiriusId.set(p.siriusId.trim().toLowerCase(), p.id);
  }

  const nidList = [...refNids];
  const stagedRes = await db.execute(sql`
    SELECT nid, bundle, title, fields, content_hash FROM s1_staging.records
     WHERE nid IN (${sql.join(nidList.map((n) => sql`${n}`), sql`, `)})
  `);
  const stagedByNid = new Map(
    (stagedRes as unknown as { rows: Array<{ nid: string | number; bundle: string; title: string | null; fields: unknown; content_hash: string | null }> }).rows.map(
      (r) => [
        Number(r.nid),
        {
          bundle: r.bundle,
          title: r.title,
          fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
          contentHash: r.content_hash == null ? null : String(r.content_hash),
        },
      ],
    ),
  );

  const resolved = new Map<number, string>(); // nid → policy row id
  /** nids short-circuited by the consumed-fingerprint fast path — step 3
   * must not re-count them, and their fingerprints are already current. */
  const fastPathNids = new Set<number>();
  const targetBundles: Record<string, number> = {};
  const mappedToInactive: Record<string, number> = {};
  for (const nid of nidList) {
    const staged = stagedByNid.get(nid);
    if (!staged) {
      // Deleted S1 node (the 23 prod orphan refs — P4 query:
      // refs_without_node=23). Ruling 2026-08-11: map to the Inactive policy
      // (sirius_id=U) instead of rejecting as policy_ref_not_staged (retired).
      // Reported per nid with its election count so an unexpected nid stays
      // visible; on re-runs the existing mapping wins (idempotent) but the
      // nid is still reported. No staged hash exists, so these mappings keep
      // a null consumed fingerprint — the branch itself IS the cheap path.
      mappedToInactive[String(nid)] = electionRefCounts.get(nid) ?? 0;
      resolved.set(nid, existing.get(nid)?.s2Id ?? inactivePolicy.id);
      continue;
    }
    const mapping = existing.get(nid);
    // Consumed-fingerprint fast path (Task 292): unchanged staged content at
    // the same logic version keeps the existing mapping without re-resolving.
    // CHANGED refs fall through and re-resolve — S1 wins during the dual-run,
    // so a ref that now resolves elsewhere is REMAPPED in step 3.
    if (mapping && classifyRow(mapping, staged.contentHash, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      resolved.set(nid, mapping.s2Id);
      fastPathNids.add(nid);
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }
    targetBundles[staged.bundle] = (targetBundles[staged.bundle] ?? 0) + 1;

    // Resolution order:
    //   1. Fund-ruled S1-title alias (N27) — covers sirius_json_definition nodes
    //      where S1 and S2 use different names/codes for the same plan (e.g.
    //      S1's "UNITE HERE Plan" appeal variants → sirius_id=UH).
    //   2. Direct name / siriusId match against S2 policy rows.
    let match: string | undefined;
    if (staged.title) {
      const aliasedSiriusId = S1_TITLE_TO_SIRIUS_ID[staged.title.trim().toLowerCase()];
      if (aliasedSiriusId) match = bySiriusId.get(aliasedSiriusId.toLowerCase());
    }
    if (!match) {
      const candidates = [
        staged.title,
        strOf(staged.fields, "field_sirius_name_short"),
        strOf(staged.fields, "field_sirius_id"),
      ].filter((c): c is string => !!c);
      match = candidates.map((c) => byName.get(c.trim().toLowerCase())).find((id) => id != null);
    }
    if (!match) {
      // A row of the policy bundle that no election references and that
      // matches no S2 policy is NOT a policy ref — sirius_json_definition is a
      // generic JSON-definition store and can hold non-policy nodes (dev:
      // "workers_v1"; prod §P4 only confirms the 15 REFERENCED nodes are
      // plans). Distinct, allowable reject class so the operator explicitly
      // acknowledges every skipped title. Referenced-but-unmatched stays
      // unconditionally fatal.
      if (electionReferencedNids.has(nid)) {
        rejects.add("policy_unmatched", { nid, bundle: staged.bundle, title: staged.title }, nid);
      } else {
        rejects.add("policy_unmatched_unreferenced", { nid, bundle: staged.bundle, title: staged.title }, nid);
      }
      continue;
    }
    resolved.set(nid, match);
  }
  report.policyTargetBundles = targetBundles;
  report.mappedToInactive = mappedToInactive;

  // policy_unmatched is always fatal (fix the alias table or seed missing S2
  // policy rows). policy_unmatched_unreferenced (non-policy rows of the
  // sirius_json_definition bundle) is allowable via --allow-rejects. Unstaged
  // refs no longer reject — they map to the Inactive policy (see
  // mappedToInactive above; ruling 2026-08-11).
  const unmatchedCount = rejects.counts["policy_unmatched"] ?? 0;
  if (unmatchedCount > 0) {
    report.rejects = rejects.counts;
    report.rejectSamples = rejects.samples;
    report.error =
      `${unmatchedCount} policy reference(s) unmatched — fix the S1_TITLE_TO_SIRIUS_ID alias table ` +
      `or run seed-migration-policies.ts to create missing S2 policies. No id_map rows written.`;
    progress.stop();
    emitLoaderResult(
      buildLoaderResult({
        loader: LOADER,
        logicVersion: LOGIC_VERSION,
        dryRun: DRY_RUN,
        forceReconcile: FORCE_RECONCILE,
        summary,
        rejects,
        allowedRejects: ALLOWED_REJECTS,
        verifyFailures: 0,
        detail: report,
      }),
    );
    if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);
    process.exit(1);
  }

  // 3) Write id_map entries (the only writes this loader performs): new
  // mappings, and S1-wins REMAPS when a changed source resolves elsewhere.
  let written = 0;
  let matchedIdMap = 0;
  const remappedNids: number[] = [];
  /** fingerprint advances for pre-existing mappings of STAGED refs, applied
   * after verify (deleted-node refs keep a null fingerprint by design). */
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  for (const [nid, policyId] of resolved) {
    if (fastPathNids.has(nid)) {
      matchedIdMap++;
      continue; // fingerprint already current — nothing to write or advance
    }
    const mapping = existing.get(nid);
    const stagedHash = stagedByNid.get(nid)?.contentHash ?? null;
    if (mapping) {
      if (mapping.s2Id !== policyId) {
        // Changed source resolves onto a DIFFERENT configured policy: S1 wins
        // during the dual-run — retarget the mapping (T16 stash/audits follow it).
        if (!DRY_RUN) await remapMapping("policy", nid, policyId, LOADER);
        remappedNids.push(nid);
        summary.updated++;
      } else {
        matchedIdMap++;
        summary.unchanged++; // reconciled and proven drift-free
      }
      if (!DRY_RUN && stagedByNid.has(nid)) pendingAdvance.push({ s1Id: nid, fingerprint: stagedHash });
      continue;
    }
    if (!DRY_RUN) {
      const winner = await putMapping("policy", nid, policyId, {
        stub: false,
        loader: LOADER,
        // Stamped at insert: the mapping IS this loader's write; verify below
        // re-checks the target against the already-loaded policy set.
        fingerprint: stagedByNid.has(nid) ? stagedHash : null,
        logicVersion: LOGIC_VERSION,
      });
      if (winner !== policyId) console.error(`RACE: policy nid ${nid} already mapped to ${winner}`);
    }
    written++;
    summary.created++;
  }
  report.mappingsWritten = written;
  report.matchedIdMap = matchedIdMap;
  report.remappedNids = remappedNids;
  report.fastPathSkips = fastPathSkips;

  // 4) Verify: every resolved ref maps to an existing policies row —
  // including deleted-node orphans, which now map to Inactive (2026-08-11)
  // and are no longer skipped here.
  let verifyFailures = 0;
  const verifyFailedNids = new Set<number>();
  if (!DRY_RUN) {
    // Target-existence check against the policy set loaded at startup — this
    // loader never creates policies rows, so the set is current. No per-row
    // storage reads (sync contract); the single batched getMappings re-read
    // proves the mapping writes landed.
    const policyIdSet = new Set(s2Policies.map((p) => p.id));
    const vMap = await getMappings("policy", nidList);
    for (const nid of nidList) {
      if (rejects.has("policy_unmatched_unreferenced", nid)) continue; // non-policy bundle row — no mapping by design
      const m = vMap.get(nid);
      if (!m) {
        console.error(`VERIFY: policy nid ${nid} has no id_map entry`);
        verifyFailures++;
        verifyFailedNids.add(nid);
        continue;
      }
      if (!policyIdSet.has(m.s2Id)) {
        console.error(`VERIFY: policy nid ${nid} maps to missing policies row ${m.s2Id}`);
        verifyFailures++;
        verifyFailedNids.add(nid);
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — only after
  // the mapping writes landed and the verify target is established ----
  if (!DRY_RUN) {
    const toAdvance = pendingAdvance.filter((p) => !verifyFailedNids.has(p.s1Id));
    await advanceFingerprints("policy", toAdvance, LOGIC_VERSION);
  }

  // ---- deletion sweep: mapped nids no longer staged NOR election-referenced.
  // Deleted-node refs stay CURRENT while elections reference them (Inactive
  // absorption ruling) — only fully-vanished sources become candidates.
  // Policy: report-only — this loader adopts configured S2 policies; nothing
  // S2-side is deleted without an operator ruling. ----
  const findings: SyncFinding[] = [];
  const sweep = await sweepDeletions({
    entity: "policy",
    loaders: [LOADER],
    sourceIds: refNids,
    dryRun: DRY_RUN,
    policy: async () => ({
      action: "report-only",
      detail: { reason: "policy mappings adopt configured S2 policies; S1 deletion needs an operator ruling" },
    }),
  });
  summary.deleted += sweep.deleted;
  summary.deactivated += sweep.deactivated;
  summary.reportOnly += sweep.reportOnly;
  findings.push(...sweep.findings);
  report.sweep = { candidates: sweep.candidates, alreadyHandled: sweep.alreadyHandled };

  progress.stop();
  report.rejects = rejects.counts;
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
    findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) {
    await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);
  }

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(
      `FAIL: ${result.blockingFindings.length} blocking sync finding(s) (${[...new Set(result.blockingFindings.map((f) => f.kind))].join(", ")}). ` +
        `Resolve them or acknowledge per run via --allow-findings.`,
    );
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
