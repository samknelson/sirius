/**
 * Seed three S2 `policies` rows required for the T-policies loader to resolve
 * all 15 S1 sirius_json_definition plan titles (N27 / P4 ruling 2026-08-06).
 *
 * The four original S2 policies (PA, R, EC, COBRA) were seeded at DB setup
 * time. These three additional plans appear in S1 production but have no S2
 * equivalent yet:
 *
 *   siriusId=RES  "RESTAURANT Plan"            (distinct from "UNITE HERE Plan"
 *                                                which maps to sirius_id=R)
 *   siriusId=TT   "THERE THERE Restaurant Plan"
 *   siriusId=U    "Inactive"                   (elections referencing a retired
 *                                                / inactive plan definition)
 *
 * Note: these are stub policy rows for migration provenance only. They carry
 * NO benefit eligibility configuration (empty data). If workers enrolled under
 * these plans need active S2 coverage, a fund admin must configure the policy
 * (add benefits, trust-eligibility plugin configs) after migration.
 *
 * Idempotent: skips rows whose siriusId already exists.
 *
 * Run: npx tsx scripts/s1-migration/seed-migration-policies.ts
 *
 * Run on BOTH dev and prod target DBs before running load-policies.ts.
 */
import { pool as pgPool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";

const NEW_POLICIES = [
  {
    siriusId: "RES",
    name: "RESTAURANT Plan",
    data: { migrationNote: "Seeded 2026-08-06 (N27/P4). S1 plan distinct from UNITE HERE Plan. Requires fund benefit configuration." },
  },
  {
    siriusId: "TT",
    name: "THERE THERE Restaurant Plan",
    data: { migrationNote: "Seeded 2026-08-06 (N27/P4). S1 There There site plan. Requires fund benefit configuration." },
  },
  {
    siriusId: "U",
    name: "Inactive",
    data: { migrationNote: "Seeded 2026-08-06 (N27/P4). Represents S1 'Inactive' plan definitions. No active benefit config expected." },
  },
] as const;

async function main() {
  const existing = await storage.policies.getAllPolicies();
  const existingSiriusIds = new Set(existing.map((p) => p.siriusId));

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
  console.log(JSON.stringify({ created, skipped, totalPolicies: final.length, policies: final.map((p) => ({ id: p.id, siriusId: p.siriusId, name: p.name })) }, null, 2));
  await pgPool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
