/**
 * One-time audit: list elections whose STORED policy (legacy
 * worker_trust_elections.policy_id) disagrees with the policy DERIVED from
 * the election's employer's policy history as of the election's coverage
 * window — so staff can review mismatches before behavior changes.
 *
 * For each election with a stored policy, the derived policy is checked at
 * the start date and at the first of every month across the coverage window
 * (capped at today for open-ended elections). Any month where the derived
 * policy differs from the stored one is reported.
 *
 * Run: npx tsx scripts/oneoffs/audit-election-policy-discrepancies.ts
 * Read-only — makes no writes.
 */
// Import storage/database BEFORE anything that touches plugins to avoid the
// PluginRegistry circular-init crash.
import "../../server/db";
import { storage } from "../../server/storage";
import {
  resolveEmployerPolicyAsOf,
  createPolicyResolutionCache,
} from "../../server/services/policy-resolution";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function firstOfNextMonth(fromYmd: string): string {
  const [y, m] = fromYmd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m is 1-based → next month, day 1
  return ymd(d);
}

async function main() {
  const elections = await storage.workerTrustElections.search({});
  const cache = createPolicyResolutionCache();
  const today = ymd(new Date());

  let checked = 0;
  let mismatched = 0;
  const lines: string[] = [];

  for (const e of elections) {
    if (!e.policyId) continue; // nothing stored to disagree with
    checked++;

    const start = String(e.startYmd).slice(0, 10);
    const end = e.endYmd ? String(e.endYmd).slice(0, 10) : today;
    const cappedEnd = end > today ? today : end;

    const badMonths: Array<{ asOf: string; derived: string }> = [];
    let asOf = start;
    let guard = 0;
    while (asOf <= cappedEnd && guard++ < 1200) {
      const { policy } = await resolveEmployerPolicyAsOf(
        storage,
        e.employerId,
        asOf,
        cache,
      );
      const derivedId = policy?.id ?? null;
      if (derivedId !== e.policyId) {
        badMonths.push({
          asOf,
          derived: policy ? `${policy.name ?? policy.id}` : "(none)",
        });
      }
      asOf = firstOfNextMonth(asOf);
    }

    if (badMonths.length > 0) {
      mismatched++;
      const stored = await storage.policies.getPolicyById(e.policyId);
      lines.push(
        [
          `election=${e.id}`,
          `worker=${e.workerId}`,
          `employer=${e.employerId}`,
          `window=${start}..${e.endYmd ? end : "open"}`,
          `stored=${stored?.name ?? e.policyId}`,
          `mismatchedMonths=${badMonths.length}`,
          `first=${badMonths[0].asOf}→${badMonths[0].derived}`,
          `last=${badMonths[badMonths.length - 1].asOf}→${badMonths[badMonths.length - 1].derived}`,
        ].join("  "),
      );
    }
  }

  console.log(`Elections with a stored policy checked: ${checked}`);
  console.log(`Elections with at least one mismatched month: ${mismatched}`);
  if (lines.length) {
    console.log("\n--- Discrepancies (stored vs derived-as-of) ---");
    for (const l of lines) console.log(l);
  } else {
    console.log("No discrepancies: stored policies match the derived as-of policy everywhere.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
