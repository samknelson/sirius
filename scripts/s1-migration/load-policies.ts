/**
 * Policies loader — maps S1 policy references onto S2's CONFIGURED `policies`
 * rows. Milestone 3 (load order: employers → policies → relationships).
 *
 * S1 has NO policy bundle in the production census (04 §bundle table, 40
 * bundles) — yet elections carry `field_sirius_trust_policy` target ids
 * (223,909 rows in production). The synthetic dev DB has the field table but
 * ZERO rows, so the target bundle cannot be determined from here; the prod
 * query pack (07 §policy-target) must answer it before the real run.
 *
 * This loader therefore ADOPTS, never creates:
 *   - S2 `policies` rows are configuration (they carry benefitIds config and
 *     seeded sirius_id codes like PA/R/EC/COBRA) — creating them from S1
 *     titles would produce broken policy configs. Unresolvable references
 *     HARD-FAIL before any id_map write.
 *   - Resolution per referenced nid: staged record (any bundle) → candidate
 *     names (title, field_sirius_name_short, field_sirius_id) → match against
 *     policies.name / policies.sirius_id (case-insensitive) → id_map entity
 *     "policy" (audit trail for T16's data.s1PolicyNid stash).
 *
 * Elections themselves do NOT store a policy id in S2 (02 §5b — policy is
 * derived via resolveEmployerPolicyAsOf); the id_map entries exist so T16 can
 * stash/audit and so employer policy setup can be cross-checked.
 *
 * Idempotent: re-run resolves via id_map, zero writes.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-policies.ts [--dry-run]
 *
 * Output is AGGREGATES ONLY — safe inside the HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, loadStaged, targetNidOf, strOf } from "./lib/loader-utils";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t-policies";

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN };
  const rejects = new RejectLog();

  // 1) Every S1 policy reference: election field targets + any staged
  //    sirius_trust_policy bundle rows (prod-proofing — census says none).
  const elections = await loadStaged("sirius_trust_worker_election");
  const policyBundleRows = await loadStaged("sirius_trust_policy");
  const refNids = new Set<number>(policyBundleRows.map((r) => r.nid));
  for (const e of elections) {
    const nid = targetNidOf(e.fields, "field_sirius_trust_policy");
    if (nid != null) refNids.add(nid);
  }
  report.stagedElections = elections.length;
  report.stagedPolicyBundleRows = policyBundleRows.length;
  report.distinctPolicyRefs = refNids.size;

  const s2Policies = await storage.policies.getAllPolicies();
  report.s2Policies = s2Policies.length;

  if (refNids.size === 0) {
    report.note = "no policy references in staging (synthetic gap — prod has 223,909; see 07 §policy-target)";
    report.verifyFailures = 0;
    console.log(JSON.stringify(report, null, 2));
    if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);
    process.exit(0);
  }

  // 2) Resolve ALL references before writing anything (fail-loud preflight).
  const existing = await getMappings("policy", [...refNids]);
  const byName = new Map<string, string>();
  for (const p of s2Policies) {
    if (p.name) byName.set(p.name.trim().toLowerCase(), p.id);
    byName.set(p.siriusId.trim().toLowerCase(), p.id);
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

  const resolved = new Map<number, string>(); // nid → policy id
  const targetBundles: Record<string, number> = {};
  for (const nid of nidList) {
    if (existing.get(nid)) {
      resolved.set(nid, existing.get(nid)!.s2Id);
      continue;
    }
    const staged = stagedByNid.get(nid);
    if (!staged) {
      rejects.add("policy_ref_not_staged", { nid }, nid);
      continue;
    }
    targetBundles[staged.bundle] = (targetBundles[staged.bundle] ?? 0) + 1;
    const candidates = [
      staged.title,
      strOf(staged.fields, "field_sirius_name_short"),
      strOf(staged.fields, "field_sirius_id"),
    ].filter((c): c is string => !!c);
    const match = candidates.map((c) => byName.get(c.trim().toLowerCase())).find((id) => id != null);
    if (!match) {
      rejects.add("policy_unmatched", { nid, bundle: staged.bundle }, nid);
      continue;
    }
    resolved.set(nid, match);
  }
  report.policyTargetBundles = targetBundles;

  const unresolvedCount = (rejects.counts["policy_ref_not_staged"] ?? 0) + (rejects.counts["policy_unmatched"] ?? 0);
  if (unresolvedCount > 0) {
    report.rejects = rejects.counts;
    report.rejectSamples = rejects.samples;
    report.error = `${unresolvedCount} policy reference(s) unresolvable — policies are ADOPT-ONLY config; fix the S2 policies setup or the name map before loading (no id_map rows written)`;
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

  // 4) Verify: every ref resolves to an existing policies row.
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vMap = await getMappings("policy", nidList);
    for (const nid of nidList) {
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

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);
  process.exit(verifyFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
