/**
 * Parity smoke test for the charge config override resolution (Task #355).
 *
 * `mergeEnabledChargeConfigs` is the highest-risk, billing-critical piece of
 * the charge migration: an employer-scoped config must override a global config
 * that targets the SAME ledger account (a null account being its own bucket),
 * while leaving non-overlapping globals in place. This script asserts that
 * behavior against hand-computed expectations for the documented scenarios so a
 * regression in the merge is caught without a database.
 *
 *   npx tsx scripts/oneoffs/verify-charge-config-resolution.ts
 */
import { mergeEnabledChargeConfigs } from "../../server/plugins/ledger/charge/charge-config-resolution";
import type { ChargePluginConfig } from "../../shared/schema";

function cfg(id: string, scope: string, account: string | null, employerId: string | null): ChargePluginConfig {
  return {
    id,
    pluginId: "demo",
    name: id,
    enabled: true,
    scope,
    employerId,
    account,
    settings: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

let failures = 0;
function check(label: string, actual: ChargePluginConfig[], expectedIds: string[]): void {
  const actualIds = actual.map((c) => c.id);
  const ok =
    actualIds.length === expectedIds.length &&
    expectedIds.every((id) => actualIds.includes(id));
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
    console.error(`        expected [${expectedIds.join(", ")}]`);
    console.error(`        actual   [${actualIds.join(", ")}]`);
  }
}

console.log("Charge config resolution parity:");

// 1. Global-only (no employer configs) → globals returned unchanged.
check(
  "global-only returns all globals",
  mergeEnabledChargeConfigs([cfg("g-A", "global", "acctA", null), cfg("g-B", "global", "acctB", null)], []),
  ["g-A", "g-B"],
);

// 2. Employer-only (no globals) → employer configs returned.
check(
  "employer-only returns employer configs",
  mergeEnabledChargeConfigs([], [cfg("e-A", "employer", "acctA", "emp1")]),
  ["e-A"],
);

// 3. Mixed, same account → employer overrides the matching global only.
check(
  "employer overrides global on the same account, other global kept",
  mergeEnabledChargeConfigs(
    [cfg("g-A", "global", "acctA", null), cfg("g-B", "global", "acctB", null)],
    [cfg("e-A", "employer", "acctA", "emp1")],
  ),
  ["g-B", "e-A"],
);

// 4. Multi-account employer configs override their own accounts only.
check(
  "multi-account: each employer config overrides its own account",
  mergeEnabledChargeConfigs(
    [cfg("g-A", "global", "acctA", null), cfg("g-B", "global", "acctB", null), cfg("g-C", "global", "acctC", null)],
    [cfg("e-A", "employer", "acctA", "emp1"), cfg("e-C", "employer", "acctC", "emp1")],
  ),
  ["g-B", "e-A", "e-C"],
);

// 5. Null account is its own bucket → employer null-account overrides global null-account.
check(
  "null-account employer overrides null-account global",
  mergeEnabledChargeConfigs(
    [cfg("g-null", "global", null, null), cfg("g-A", "global", "acctA", null)],
    [cfg("e-null", "employer", null, "emp1")],
  ),
  ["g-A", "e-null"],
);

// 6. Employer config on a different account → global is NOT overridden.
check(
  "employer on a different account leaves global in place",
  mergeEnabledChargeConfigs(
    [cfg("g-A", "global", "acctA", null)],
    [cfg("e-B", "employer", "acctB", "emp1")],
  ),
  ["g-A", "e-B"],
);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll charge config resolution checks passed.");
