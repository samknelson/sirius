/**
 * One-off verification for the BAO - Start HealthNet seed
 * (scripts/oneoffs/seed-start-healthnet-workers.ts). Replicates the production
 * POST /api/eligibility/evaluate path: load the trust-eligibility rules for the
 * EVENT CENTER Plan + Health Net benefit, then evaluate each seeded worker as a
 * "start" scan and print the verdict + reason.
 *
 * Two sections:
 *   1. All five workers as-of June 2026 (every criterion path satisfied).
 *   2. As-of bounding checks: the HealthNet ("ever held") and continuous-medical
 *      criteria only count coverage dated on/before the evaluated month, so the
 *      same worker flips eligibility depending on the as-of date.
 *
 * Usage: npx tsx scripts/oneoffs/verify-start-healthnet-eligibility.ts
 */

import { storage } from "../../server/storage/database";
import {
  evaluateBenefitEligibility,
  pluginConfigToEligibilityRule,
} from "../../server/plugins/trust/eligibility/executor";
// Side-effect import: registers every eligibility plugin into the registry.
import "../../server/plugins/trust/eligibility/index";

const POLICY_ID = "a5b9e6dd-c9ce-47bb-b7cf-7370e160b227";
const HEALTHNET_BENEFIT_ID = "1f4b013d-12bc-4960-9f69-a3d738b6fd91";

const WORKERS: Array<{ label: string; name: string; expect: string }> = [
  { label: "Criterion 1 (geographic)", name: "[HN] Geographic (far from site)", expect: "ELIGIBLE" },
  { label: "Criterion 2 (ever HealthNet)", name: "[HN] Ever had Health Net", expect: "ELIGIBLE" },
  { label: "Criterion 3 (continuous medical)", name: "[HN] 24mo continuous medical (MLK)", expect: "ELIGIBLE" },
  { label: "Criterion 4 (employer window)", name: "[HN] Employer immediate-eligibility", expect: "ELIGIBLE" },
  { label: "Control (none)", name: "[HN] Not eligible (no criterion)", expect: "NOT eligible" },
];

// As-of bounding cases: the same seeded worker should flip eligibility based on
// the evaluated month, because criteria 2 (ever HealthNet) and 3 (continuous
// medical) only count coverage dated on/before the as-of month.
const BOUNDING_CASES: Array<{
  name: string;
  asOfYear: number;
  asOfMonth: number;
  expect: string;
  note: string;
}> = [
  // Medical run is seeded 2023-01 → 2024-12 (24 consecutive months).
  { name: "[HN] 24mo continuous medical (MLK)", asOfYear: 2023, asOfMonth: 6, expect: "NOT eligible", note: "only 6 of 24 months elapsed by Jun 2023" },
  { name: "[HN] 24mo continuous medical (MLK)", asOfYear: 2024, asOfMonth: 12, expect: "ELIGIBLE", note: "24th consecutive month reached Dec 2024" },
  // Health Net coverage is seeded 2022-01 → 2022-03.
  { name: "[HN] Ever had Health Net", asOfYear: 2021, asOfMonth: 12, expect: "NOT eligible", note: "no Health Net coverage on/before Dec 2021" },
  { name: "[HN] Ever had Health Net", asOfYear: 2022, asOfMonth: 1, expect: "ELIGIBLE", note: "first Health Net month is Jan 2022" },
];

type Rules = ReturnType<typeof pluginConfigToEligibilityRule>[];

async function evaluateWorker(
  name: string,
  rules: Rules,
  asOfYear: number,
  asOfMonth: number,
): Promise<{ verdict: string; reasons: string; workerId: string } | null> {
  const found = await storage.workers.searchWorkers(name, 10);
  const worker = found.workers.find((x) => x.displayName === name);
  if (!worker) return null;
  const result = await evaluateBenefitEligibility(HEALTHNET_BENEFIT_ID, rules, {
    scanType: "start",
    workerId: worker.id,
    asOfMonth,
    asOfYear,
    stopAfterIneligible: false,
  });
  return {
    verdict: result.eligible ? "ELIGIBLE" : "NOT eligible",
    reasons: result.results.map((r) => `${r.eligible ? "+" : "-"} ${r.reason}`).join(" | "),
    workerId: worker.id,
  };
}

async function main(): Promise<void> {
  const ruleRows = await storage.pluginConfigs.search("trust-eligibility", {
    policy: POLICY_ID,
    benefit: HEALTHNET_BENEFIT_ID,
  });
  const rules = ruleRows.map((r) => pluginConfigToEligibilityRule(r.config));
  console.log(`Loaded ${rules.length} rule(s) for EVENT CENTER Plan + Health Net.\n`);

  console.log("=== Section 1: all workers as-of June 2026 ===\n");
  for (const w of WORKERS) {
    const r = await evaluateWorker(w.name, rules, 2026, 6);
    if (!r) {
      console.log(`MISSING worker: ${w.name}\n`);
      continue;
    }
    const ok = r.verdict === w.expect ? "PASS" : "*** MISMATCH ***";
    console.log(`${ok}  ${w.label}`);
    console.log(`   worker : ${r.workerId}`);
    console.log(`   verdict: ${r.verdict} (expected ${w.expect})`);
    console.log(`   detail : ${r.reasons}\n`);
  }

  console.log("=== Section 2: as-of bounding (criteria 2 & 3) ===\n");
  for (const c of BOUNDING_CASES) {
    const r = await evaluateWorker(c.name, rules, c.asOfYear, c.asOfMonth);
    const asOf = `${c.asOfYear}-${String(c.asOfMonth).padStart(2, "0")}`;
    if (!r) {
      console.log(`MISSING worker: ${c.name}\n`);
      continue;
    }
    const ok = r.verdict === c.expect ? "PASS" : "*** MISMATCH ***";
    console.log(`${ok}  ${c.name} @ ${asOf}`);
    console.log(`   reason : ${c.note}`);
    console.log(`   verdict: ${r.verdict} (expected ${c.expect})`);
    console.log(`   detail : ${r.reasons}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
