#!/usr/bin/env npx tsx
/**
 * Smoke test for the Only-One Election Violations report
 * (report_elections_only_one_violations).
 *
 * Covers, without touching a real database (storage methods are stubbed
 * in-memory on the storage singleton):
 *   - valid elections (one benefit per only-one type / multiples of a
 *     non-only-one type) are omitted
 *   - violations are grouped into ONE row per election, aggregating all
 *     violating types with names + counts
 *   - ended and future-dated elections are included
 *   - deterministic aggregation and row ordering across runs
 *   - plugin registration: Trust category, admin policy, trust.benefits
 *     component; component gating enforced (disabled → hidden + 403)
 *
 * Run: npx tsx scripts/oneoffs/smoke-report-only-one-violations.ts
 */
// Import order matters: initialize the storage module graph the same way
// the app boots, BEFORE importing plugin modules (circular-import gotcha).
import "../../server/storage/database";
import { storage } from "../../server/storage";
import { ReportElectionsOnlyOneViolations } from "../../server/plugins/wizards/engine/types/report_elections_only_one_violations";
import { reportElectionsOnlyOneViolationsPlugin } from "../../server/plugins/wizards/plugins/report-elections-only-one-violations";
import { wizardPluginRegistry } from "../../server/plugins/wizards/registry";
import {
  isPluginComponentEnabledAsync,
  isPluginComponentEnabledSync,
} from "../../server/plugins/_core/gating";
import { invalidateComponentCache } from "../../server/services/component-cache";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${JSON.stringify(detail)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture data: benefit types medical (onlyOne), dental (onlyOne),
// voluntary (NOT onlyOne).
// ---------------------------------------------------------------------------
const benefits = [
  { id: "b-med-a", name: "Medical Plan A", benefitType: "type-med", benefitTypeName: "Medical", benefitTypeOnlyOne: true },
  { id: "b-med-b", name: "Medical Plan B", benefitType: "type-med", benefitTypeName: "Medical", benefitTypeOnlyOne: true },
  { id: "b-den-a", name: "Dental Plan A", benefitType: "type-den", benefitTypeName: "Dental", benefitTypeOnlyOne: true },
  { id: "b-den-b", name: "Dental Plan B", benefitType: "type-den", benefitTypeName: "Dental", benefitTypeOnlyOne: true },
  { id: "b-vol-a", name: "Vision", benefitType: "type-vol", benefitTypeName: "Voluntary", benefitTypeOnlyOne: false },
  { id: "b-vol-b", name: "Life", benefitType: "type-vol", benefitTypeName: "Voluntary", benefitTypeOnlyOne: false },
];

const elections = [
  // Valid: one medical, one dental, two voluntary (non-only-one) → omitted.
  { id: "e-valid", workerId: "w1", workerName: "Alice Adams", employerId: "emp1", employerName: "Acme", startYmd: "2025-01-01", endYmd: null, benefitIds: ["b-med-a", "b-den-a", "b-vol-a", "b-vol-b"] },
  // Current violation: two medical.
  { id: "e-current", workerId: "w2", workerName: "Bob Brown", employerId: "emp1", employerName: "Acme", startYmd: "2025-02-01", endYmd: null, benefitIds: ["b-med-b", "b-med-a"] },
  // Ended (historical) violation: two dental.
  { id: "e-ended", workerId: "w3", workerName: "Carol Clark", employerId: "emp2", employerName: "Beta Co", startYmd: "2023-01-01", endYmd: "2023-12-31", benefitIds: ["b-den-b", "b-den-a"] },
  // Future-dated violation with TWO violating types on one election.
  { id: "e-future", workerId: "w4", workerName: "Dan Diaz", employerId: "emp2", employerName: "Beta Co", startYmd: "2027-01-01", endYmd: null, benefitIds: ["b-den-b", "b-med-b", "b-den-a", "b-med-a"] },
  // Unknown benefit id + null-ish benefitIds shapes → omitted, no crash.
  { id: "e-unknown", workerId: "w5", workerName: "Eve Evans", employerId: "emp1", employerName: "Acme", startYmd: "2025-03-01", endYmd: null, benefitIds: ["ghost-benefit"] },
  { id: "e-empty", workerId: "w6", workerName: "Fay Fox", employerId: "emp1", employerName: "Acme", startYmd: "2025-04-01", endYmd: null, benefitIds: null },
];

(storage.trustBenefits as any).getAllTrustBenefits = async () => benefits;
(storage.workerTrustElections as any).searchViews = async (params: any) => {
  if (params && Object.keys(params).some((k) => params[k] !== undefined)) {
    throw new Error("report must scan ALL elections (no filters)");
  }
  return elections;
};

async function main() {
  const report = new ReportElectionsOnlyOneViolations();

  console.log("Detection:");
  const records = await report.fetchRecords({});
  check("only violating elections reported (3 of 6)", records.length === 3, records.map((r) => r.electionId));
  check("valid election omitted", !records.some((r) => r.electionId === "e-valid"));
  check("multi-voluntary (non-onlyOne) not flagged", !records.some((r) => String(r.violatingTypes).includes("Voluntary")));
  check("unknown/empty benefit lists omitted", !records.some((r) => ["e-unknown", "e-empty"].includes(String(r.electionId))));

  const current = records.find((r) => r.electionId === "e-current");
  check("current violation included", !!current);
  check("worker/employer context", current?.workerName === "Bob Brown" && current?.employerName === "Acme");
  check("election date range", current?.startYmd === "2025-02-01" && current?.endYmd === "");
  check("violating type named", current?.violatingTypes === "Medical");
  check(
    "conflicting benefits sorted with count",
    current?.conflictingBenefits === "Medical (2): Medical Plan A, Medical Plan B",
    current?.conflictingBenefits,
  );
  check(
    "standard election link",
    (current?.electionLink as any)?.url === "/trust/election/e-current" && (current?.electionLink as any)?.label === "View Election",
  );

  const ended = records.find((r) => r.electionId === "e-ended");
  check("ended (historical) election included", !!ended && ended.endYmd === "2023-12-31");

  const future = records.find((r) => r.electionId === "e-future");
  check("future-dated election included", !!future);
  check("both violating types on ONE row (no duplicate rows)", records.filter((r) => r.electionId === "e-future").length === 1);
  check("types aggregated deterministically (sorted)", future?.violatingTypes === "Dental; Medical", future?.violatingTypes);
  check(
    "per-type benefits grouped with counts",
    future?.conflictingBenefits === "Dental (2): Dental Plan A, Dental Plan B; Medical (2): Medical Plan A, Medical Plan B",
    future?.conflictingBenefits,
  );

  const rerun = await report.fetchRecords({});
  check("deterministic across runs", JSON.stringify(records) === JSON.stringify(rerun));
  check(
    "rows ordered by worker/start/id",
    records.map((r) => r.electionId).join(",") === "e-current,e-ended,e-future",
    records.map((r) => r.electionId),
  );

  console.log("Registration & gating:");
  const plugin = wizardPluginRegistry.get("report_elections_only_one_violations");
  check("registered in wizard plugin registry", plugin === reportElectionsOnlyOneViolationsPlugin);
  check("Trust category report", plugin?.category === "Trust" && plugin?.isReport === true);
  check("admin-only", plugin?.requiredPolicy === "admin");
  check("requires trust.benefits component", plugin?.requiredComponent === "trust.benefits");
  check(
    "uses shared no-input/run/results steps",
    plugin?.steps.map((s) => s.id).join(",") === "inputs,run,results" &&
      plugin?.steps.map((s) => s.kind).join(",") === "form,run,results",
  );

  const meta = wizardPluginRegistry.getMetadata(plugin!);
  // Component gating: drive the component cache through the stubbed
  // variables storage — same choke point enforcePluginGating and the
  // registry visibility filter both read.
  let componentsValue: Record<string, boolean> = { "trust.benefits": false };
  (storage.variables as any).getByName = async (name: string) =>
    name === "components" ? { id: "var-1", name, value: componentsValue } : undefined;

  invalidateComponentCache();
  check("disabled component → async gate rejects", (await isPluginComponentEnabledAsync(meta)) === false);
  check("disabled component → hidden from sync listing filter", isPluginComponentEnabledSync(meta) === false);

  componentsValue = { "trust.benefits": true };
  invalidateComponentCache();
  check("enabled component → async gate passes", (await isPluginComponentEnabledAsync(meta)) === true);
  check("enabled component → visible to sync listing filter", isPluginComponentEnabledSync(meta) === true);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
