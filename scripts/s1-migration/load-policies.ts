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
 * Three S2 policies must be created before the prod run (siriusIds RES, TT, U
 * — run seed-migration-policies.ts on every target DB first; dev DB included).
 *
 * 23 prod refs point at deleted S1 nodes (refs_without_node from §P4 query).
 * These become policy_ref_not_staged rejects — expected and allowable:
 *   --allow-rejects policy_ref_not_staged
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
 * Usage:
 *   npx tsx scripts/s1-migration/load-policies.ts [--dry-run] \
 *     [--allow-rejects policy_ref_not_staged]
 *
 * Output is AGGREGATES ONLY — safe inside the HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, loadStaged, targetNidOf, strOf } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t-policies";
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
  // UNITE HERE Plan family → S2 "Restaurant Plan" (sirius_id=R)
  "unite here plan": "R",
  "unite here plan - delta appeal": "R",
  "unite here plan - kaiser appeal": "R",
  "unite here plan - healthnet appeal": "R",
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

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

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
  const electionReferencedNids = new Set<number>();
  for (const e of elections) {
    const nid = targetNidOf(e.fields, "field_sirius_trust_policy");
    if (nid != null) electionReferencedNids.add(nid);
  }
  const refNids = new Set<number>([...policyBundleRows.map((r) => r.nid), ...electionReferencedNids]);
  report.stagedElections = elections.length;
  report.stagedPolicyBundleRows = policyBundleRows.length;
  report.distinctPolicyRefs = refNids.size;

  const s2Policies = await storage.policies.getAllPolicies();
  report.s2Policies = s2Policies.length;

  if (refNids.size === 0) {
    report.note =
      "no policy references in staging (synthetic gap — prod has 242,664 refs; see 07 §P4). " +
      "Stage sirius_json_definition before running on prod.";
    report.verifyFailures = 0;
    console.log(JSON.stringify(report, null, 2));
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
    SELECT nid, bundle, title, fields FROM s1_staging.records
     WHERE nid IN (${sql.join(nidList.map((n) => sql`${n}`), sql`, `)})
  `);
  const stagedByNid = new Map(
    (stagedRes as unknown as { rows: Array<{ nid: string | number; bundle: string; title: string | null; fields: unknown }> }).rows.map(
      (r) => [
        Number(r.nid),
        {
          bundle: r.bundle,
          title: r.title,
          fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
        },
      ],
    ),
  );

  const resolved = new Map<number, string>(); // nid → policy row id
  const targetBundles: Record<string, number> = {};
  for (const nid of nidList) {
    if (existing.get(nid)) {
      resolved.set(nid, existing.get(nid)!.s2Id);
      continue;
    }
    const staged = stagedByNid.get(nid);
    if (!staged) {
      // Expected for the 23 prod orphan refs (P4 query: refs_without_node=23).
      // Allow via --allow-rejects policy_ref_not_staged.
      rejects.add("policy_ref_not_staged", { nid }, nid);
      continue;
    }
    targetBundles[staged.bundle] = (targetBundles[staged.bundle] ?? 0) + 1;

    // Resolution order:
    //   1. Fund-ruled S1-title alias (N27) — covers sirius_json_definition nodes
    //      where S1 and S2 use different names for the same plan (e.g. S1's
    //      "UNITE HERE Plan" → S2's "Restaurant Plan" / sirius_id=R).
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

  // policy_unmatched is always fatal (fix the alias table or seed missing S2
  // policy rows). policy_ref_not_staged is expected (23 prod orphans) and
  // allowable via --allow-rejects, as is policy_unmatched_unreferenced
  // (non-policy rows of the sirius_json_definition bundle).
  const unmatchedCount = rejects.counts["policy_unmatched"] ?? 0;
  if (unmatchedCount > 0) {
    report.rejects = rejects.counts;
    report.rejectSamples = rejects.samples;
    report.error =
      `${unmatchedCount} policy reference(s) unmatched — fix the S1_TITLE_TO_SIRIUS_ID alias table ` +
      `or run seed-migration-policies.ts to create missing S2 policies. No id_map rows written.`;
    console.log(JSON.stringify(report, null, 2));
    if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);
    process.exit(1);
  }

  // 3) Write id_map entries (the only write this loader performs).
  let written = 0;
  let matchedIdMap = 0;
  for (const [nid, policyId] of resolved) {
    if (existing.get(nid)) {
      matchedIdMap++;
      continue;
    }
    if (!DRY_RUN) {
      const winner = await putMapping("policy", nid, policyId, { stub: false, loader: LOADER });
      if (winner !== policyId) console.error(`RACE: policy nid ${nid} already mapped to ${winner}`);
    }
    written++;
  }
  report.mappingsWritten = written;
  report.matchedIdMap = matchedIdMap;

  // 4) Verify: every resolved ref maps to an existing policies row.
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vMap = await getMappings("policy", nidList);
    for (const nid of nidList) {
      if (!stagedByNid.has(nid)) continue; // orphan — not expected to have a mapping
      if (rejects.has("policy_unmatched_unreferenced", nid)) continue; // non-policy bundle row — no mapping by design
      const m = vMap.get(nid);
      if (!m) {
        console.error(`VERIFY: policy nid ${nid} has no id_map entry`);
        verifyFailures++;
        continue;
      }
      const row = await storage.policies.getPolicyById(m.s2Id);
      if (!row) {
        console.error(`VERIFY: policy nid ${nid} maps to missing policies row ${m.s2Id}`);
        verifyFailures++;
      }
    }
  }

  progress.stop();
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
    process.exit(1);
  }
  process.exit(verifyFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
