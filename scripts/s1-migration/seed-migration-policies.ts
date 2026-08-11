/**
 * Seed the seven S2 `policies` rows required for the T-policies loader to
 * resolve all 15 S1 sirius_json_definition plan titles (N27 / P4 ruling
 * 2026-08-06; R→UH rename ruling 2026-08-11).
 *
 * Catalogue: PA, UH, EC, COBRA (core fund policies) + RES, TT, U (S1 plans
 * with no prior S2 equivalent):
 *
 *   siriusId=UH   "Unite Here Plan"             (renamed from R / "Restaurant
 *                                                 Plan" — see rename ruling
 *                                                 below)
 *   siriusId=RES  "RESTAURANT Plan"             (distinct from "Unite Here
 *                                                 Plan" / sirius_id=UH)
 *   siriusId=TT   "THERE THERE Restaurant Plan"
 *   siriusId=U    "Inactive"                    (elections referencing a
 *                                                 retired / deleted plan
 *                                                 definition)
 *
 * R → UH rename (fund ruling 2026-08-11): "Restaurant Plan" (sirius_id=R) is
 * renamed to "Unite Here Plan" (sirius_id=UH) — SAME row, new identity. R is
 * retired and must not exist after this script runs. Resolution order on an
 * existing target:
 *   1. sirius_id=UH exists → skip (already renamed/seeded).
 *   2. else sirius_id=R exists → rename that row IN PLACE to UH /
 *      "Unite Here Plan". The row UUID is preserved, so existing id_map
 *      entries, employer_policy_history rows and employers.denorm_policy_id
 *      values remain correct — no drift correction is needed or performed.
 *      Reported as renamedFromR: 1 so the operator can confirm it happened.
 *   3. else → create UH fresh.
 * A target somehow holding BOTH R and UH aborts with both ids listed rather
 * than guessing which row is canonical. Skipping the rename step (step 2)
 * would create a duplicate policy row and orphan every existing mapping —
 * that is the primary failure mode this ordering prevents.
 *
 * Note: the RES/TT/U rows are stub policy rows for migration provenance only.
 * They carry NO benefit eligibility configuration (empty data). If workers
 * enrolled under these plans need active S2 coverage, a fund admin must
 * configure the policy (add benefits, trust-eligibility plugin configs) after
 * migration.
 *
 * Idempotent: skips rows whose siriusId already exists; the rename runs at
 * most once (afterwards UH matches and R is gone).
 *
 * Run: npx tsx scripts/s1-migration/seed-migration-policies.ts
 *
 * Run on BOTH dev and prod target DBs before running load-policies.ts.
 */
import { pool as pgPool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";

const NEW_POLICIES = [
  // Core fund policies. Historically seeded "at DB setup time" — but an
  // empty-DB-bootstrapped or wiped target has none (data-seed migrations are
  // stamped, not run), so bootstrap-target relies on this script seeding ALL
  // seven. Names match the fund's S2 config (verified against the fund
  // config source 2026-08-06; UH renamed from R per the 2026-08-11 ruling).
  {
    siriusId: "PA",
    name: "Participation Agreement",
    data: { migrationNote: "Core fund policy (seeded by seed-migration-policies for zero-preconfig bootstrap)." },
  },
  {
    siriusId: "UH",
    name: "Unite Here Plan",
    data: { migrationNote: "Core fund policy (seeded by seed-migration-policies for zero-preconfig bootstrap). Renamed from R/'Restaurant Plan' per the 2026-08-11 ruling." },
  },
  {
    siriusId: "EC",
    name: "Event Center Plan",
    data: { migrationNote: "Core fund policy (seeded by seed-migration-policies for zero-preconfig bootstrap)." },
  },
  {
    siriusId: "COBRA",
    name: "COBRA",
    data: { migrationNote: "Core fund policy (seeded by seed-migration-policies for zero-preconfig bootstrap)." },
  },
  {
    siriusId: "RES",
    name: "RESTAURANT Plan",
    data: { migrationNote: "Seeded 2026-08-06 (N27/P4). S1 plan distinct from Unite Here Plan (UH). Requires fund benefit configuration." },
  },
  {
    siriusId: "TT",
    name: "THERE THERE Restaurant Plan",
    data: { migrationNote: "Seeded 2026-08-06 (N27/P4). S1 There There site plan. Requires fund benefit configuration." },
  },
  {
    siriusId: "U",
    name: "Inactive",
    data: { migrationNote: "Seeded 2026-08-06 (N27/P4). Represents S1 'Inactive' plan definitions AND absorbs election refs to deleted S1 policy nodes (2026-08-11 ruling). No active benefit config expected." },
  },
] as const;

async function main() {
  const existing = await storage.policies.getAllPolicies();
  const bySiriusId = new Map(existing.map((p) => [p.siriusId, p]));

  // ── R → UH rename (ruling 2026-08-11) — resolved BEFORE the create/skip
  // loop so a legacy target renames its R row in place instead of creating a
  // duplicate UH row (which would orphan every existing id_map entry,
  // employer_policy_history row and denorm_policy_id value).
  let renamedFromR = 0;
  const uhRow = bySiriusId.get("UH");
  const rRow = bySiriusId.get("R");
  if (uhRow && rRow) {
    console.error(
      `FAIL: target holds BOTH siriusId=UH (id=${uhRow.id}, name="${uhRow.name}") AND ` +
        `siriusId=R (id=${rRow.id}, name="${rRow.name}"). The R→UH rename expects at most one ` +
        `of the pair — refusing to guess which row existing mappings point at. ` +
        `Resolve manually, then re-run. Nothing was written.`,
    );
    await pgPool.end();
    process.exit(1);
  }
  if (!uhRow && rRow) {
    const updated = await storage.policies.updatePolicy(rRow.id, { siriusId: "UH", name: "Unite Here Plan" });
    if (!updated) {
      console.error(`FAIL: in-place rename of policy id=${rRow.id} (R → UH) updated no row.`);
      await pgPool.end();
      process.exit(1);
    }
    console.log(
      `renamed in place: id=${rRow.id} R/"${rRow.name}" → UH/"Unite Here Plan" ` +
        `(row UUID preserved — id_map / employer_policy_history / denorm_policy_id need no correction)`,
    );
    renamedFromR = 1;
    bySiriusId.delete("R");
    bySiriusId.set("UH", updated);
  }

  const existingSiriusIds = new Set(bySiriusId.keys());

  let created = 0;
  let skipped = 0;
  for (const p of NEW_POLICIES) {
    if (existingSiriusIds.has(p.siriusId)) {
      console.log(`skip (already exists): siriusId=${p.siriusId} name="${p.name}"`);
      skipped++;
      continue;
    }
    const row = await storage.policies.createPolicy({ siriusId: p.siriusId, name: p.name, data: p.data });
    console.log(`created: id=${row.id} siriusId=${row.siriusId} name="${row.name}"`);
    created++;
  }

  const final = await storage.policies.getAllPolicies();
  console.log(JSON.stringify({ created, skipped, renamedFromR, totalPolicies: final.length, policies: final.map((p) => ({ id: p.id, siriusId: p.siriusId, name: p.name })) }, null, 2));
  await pgPool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
