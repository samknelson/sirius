/**
 * One-off verification for the BAO - Start HealthNet seed
 * (scripts/oneoffs/seed-start-healthnet-workers.ts). Replicates the production
 * POST /api/eligibility/evaluate path: load the trust-eligibility rules for the
 * EVENT CENTER Plan + Health Net benefit, then evaluate each seeded worker as a
 * "start" scan as-of June 2026 and print the verdict + reason.
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

async function main(): Promise<void> {
  const ruleRows = await storage.pluginConfigs.search("trust-eligibility", {
    policy: POLICY_ID,
    benefit: HEALTHNET_BENEFIT_ID,
  });
  const rules = ruleRows.map((r) => pluginConfigToEligibilityRule(r.config));
  console.log(`Loaded ${rules.length} rule(s) for EVENT CENTER Plan + Health Net.\n`);

  for (const w of WORKERS) {
    const found = await storage.workers.searchWorkers(w.name, 10);
    const worker = found.workers.find((x) => x.displayName === w.name);
    if (!worker) {
      console.log(`MISSING worker: ${w.name}`);
      continue;
    }
    const result = await evaluateBenefitEligibility(HEALTHNET_BENEFIT_ID, rules, {
      scanType: "start",
      workerId: worker.id,
      asOfMonth: 6,
      asOfYear: 2026,
      stopAfterIneligible: false,
    });
    const verdict = result.eligible ? "ELIGIBLE" : "NOT eligible";
    const ok = verdict === w.expect ? "PASS" : "*** MISMATCH ***";
    const reasons = result.results.map((r) => `${r.eligible ? "+" : "-"} ${r.reason}`).join(" | ");
    console.log(`${ok}  ${w.label}`);
    console.log(`   worker : ${worker.id}`);
    console.log(`   verdict: ${verdict} (expected ${w.expect})`);
    console.log(`   detail : ${reasons}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
