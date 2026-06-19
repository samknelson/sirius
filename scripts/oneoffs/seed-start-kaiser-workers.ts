/**
 * One-off: seed real workers + monthly benefit history (trust_wmb) + active
 * trust elections that exercise the "BAO - Start Kaiser" trust-eligibility
 * plugin (server/plugins/trust/eligibility/plugins/sitespecific-bao-start-kaiser.ts)
 * so it can be tested manually in the live app.
 *
 * Plugin recap — a subscriber is eligible if EITHER:
 *   1. Continuous medical: the worker held ANY benefit of the configured
 *      Medical benefit TYPE in EVERY one of the N months immediately preceding
 *      the as-of month (the as-of month itself is excluded). The configured
 *      rule uses Medical type, N = 24.
 *   2. Employer immediate-eligibility: the worker's employer is inside an
 *      immediate-eligibility window covering the as-of date. (There are
 *      currently NO such windows configured, so this criterion never passes —
 *      these workers are judged purely on criterion 1.)
 *
 * The rule is configured on:
 *   - policy  = "EVENT CENTER Plan" (a5b9e6dd...), rule id 7995a556,
 *     appliesTo ["start"], data.medical = { months: 24, benefitTypeId: Medical }.
 *   - benefit = "Kaiser" (b30b66ff...).
 *
 * The continuous-medical criterion counts ANY benefit whose TYPE is Medical —
 * not just the Kaiser benefit. Medical-type benefits in this DB: Health Net,
 * Kaiser, MLK. We use the non-Kaiser "Health Net" for the "past medical (not
 * Kaiser)" history.
 *
 * As-of month under test = June 2026 (the eligibility page's default). The
 * 24-month preceding window is therefore June 2024 → May 2026 (inclusive).
 *
 * Scenarios seeded:
 *   1. 24+ months of past medical (Health Net, NOT Kaiser) covering the whole
 *      window  => ELIGIBLE (continuous medical).
 *   2. Only 6 months of past medical (Health Net, NOT Kaiser) => NOT eligible
 *      (window has 18 uncovered months).
 *   3. Had the Kaiser benefit historically (early 2024) but not currently, and
 *      far fewer than 24 months of medical => NOT eligible.
 *
 * Everything goes through the storage layer (no raw SQL), per project rules,
 * and the script is idempotent:
 *   - workers are looked up by unique display name and reused;
 *   - benefit-history months use workerBenefitExists before createWorkerBenefit;
 *   - an election is only created if the worker has no active election.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/seed-start-kaiser-workers.ts
 */

import { storage } from "../../server/storage/database";

// Known fixtures in this database.
const EMPLOYER_ID = "9a80c1c5-7d46-4124-adc4-4be57375c5ee"; // TEST HOTEL (no immediate-eligibility window)
const POLICY_ID = "a5b9e6dd-c9ce-47bb-b7cf-7370e160b227"; // EVENT CENTER Plan (carries the Start Kaiser rule)
const KAISER_BENEFIT_ID = "b30b66ff-c52c-41a3-a0e3-e7fd20394f75"; // "Kaiser" (Medical type) — the benefit the rule evaluates
const HEALTH_NET_BENEFIT_ID = "1f4b013d-12bc-4960-9f69-a3d738b6fd91"; // "Health Net" (Medical type, NOT Kaiser)

// As-of month under test (matches the eligibility page default of June 2026).
const AS_OF = { year: 2026, month: 6 };
const MEDICAL_MONTHS = 24; // matches the configured rule

type YearMonth = { year: number; month: number };

/** year/month → ordinal (months since year 0). */
function toOrdinal(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

function fromOrdinal(ord: number): YearMonth {
  return { year: Math.floor(ord / 12), month: (ord % 12) + 1 };
}

/** Inclusive continuous run of months from `start` to `end`. */
function monthRange(start: YearMonth, end: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let ord = toOrdinal(start); ord <= toOrdinal(end); ord++) {
    out.push(fromOrdinal(ord));
  }
  return out;
}

async function findOrCreateWorker(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (exact) return exact.id;
  const created = await storage.workers.createWorker(name);
  return created.id;
}

/** Idempotently give a worker the active election that wires employer/policy. */
async function ensureElection(workerId: string): Promise<string> {
  const existing = await storage.workerTrustElections.getActiveByWorker(workerId);
  if (existing) return existing.id;
  const created = await storage.workerTrustElections.create(workerId, {
    employerId: EMPLOYER_ID,
    policyId: POLICY_ID,
    startYmd: "2024-01-01",
    benefitIds: [KAISER_BENEFIT_ID],
    relationshipIds: [],
  });
  return created.id;
}

/** Idempotently seed monthly benefit-history rows for a worker. */
async function ensureBenefitMonths(
  workerId: string,
  benefitId: string,
  months: YearMonth[],
): Promise<number> {
  let created = 0;
  for (const { year, month } of months) {
    const exists = await storage.trust.wmb.workerBenefitExists(
      workerId,
      benefitId,
      month,
      year,
    );
    if (exists) continue;
    await storage.trust.wmb.createWorkerBenefit({
      workerId,
      month,
      year,
      employerId: EMPLOYER_ID,
      benefitId,
    });
    created++;
  }
  return created;
}

async function main(): Promise<void> {
  const asOfOrdinal = toOrdinal(AS_OF);
  const windowStart = fromOrdinal(asOfOrdinal - MEDICAL_MONTHS); // June 2024
  const windowEnd = fromOrdinal(asOfOrdinal - 1); // May 2026

  // --- Scenario 1: 24+ months of past medical (Health Net, NOT Kaiser) ---
  // Seed Health Net from Jan 2024 through May 2026 (29 months) so the full
  // 24-month window June 2024 → May 2026 is covered with margin.
  const eligibleWorker = await findOrCreateWorker(
    "[KAISER] 24mo Medical (Health Net)",
  );
  await ensureElection(eligibleWorker);
  const s1Created = await ensureBenefitMonths(
    eligibleWorker,
    HEALTH_NET_BENEFIT_ID,
    monthRange({ year: 2024, month: 1 }, windowEnd),
  );

  // --- Scenario 2: only 6 months of past medical (Health Net, NOT Kaiser) ---
  // Seed Health Net for Dec 2025 → May 2026 only (6 months). The window still
  // has 18 uncovered months => not eligible.
  const sixMonthWorker = await findOrCreateWorker(
    "[KAISER] 6mo Medical (Health Net)",
  );
  await ensureElection(sixMonthWorker);
  const s2Created = await ensureBenefitMonths(
    sixMonthWorker,
    HEALTH_NET_BENEFIT_ID,
    monthRange({ year: 2025, month: 12 }, windowEnd),
  );

  // --- Scenario 3: had Kaiser historically (not currently), < 24 mo medical ---
  // Seed Kaiser for Jan 2024 → Jun 2024 (6 historical months, none recent).
  // Only Jun 2024 falls inside the window, so far fewer than 24 medical months
  // => not eligible. Demonstrates that holding Kaiser in the past does not by
  // itself satisfy the continuous-medical criterion.
  const kaiserHistoricalWorker = await findOrCreateWorker(
    "[KAISER] Kaiser historical, <24mo medical",
  );
  await ensureElection(kaiserHistoricalWorker);
  const s3Created = await ensureBenefitMonths(
    kaiserHistoricalWorker,
    KAISER_BENEFIT_ID,
    monthRange({ year: 2024, month: 1 }, { year: 2024, month: 6 }),
  );

  const fmt = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

  console.log("Seeded workers + benefit history for the BAO - Start Kaiser plugin.\n");
  console.log("Fixtures used:");
  console.log(`  policy   : EVENT CENTER Plan (${POLICY_ID})`);
  console.log(`  benefit  : Kaiser (${KAISER_BENEFIT_ID})`);
  console.log(`  employer : TEST HOTEL (${EMPLOYER_ID}) — no immediate-eligibility window`);
  console.log(`  as-of    : June 2026 (scan type "start")`);
  console.log(
    `  window   : ${MEDICAL_MONTHS} months, ${fmt(windowStart)} → ${fmt(windowEnd)} (as-of month excluded)\n`,
  );

  console.log("Scenario 1 — 24+ months of medical (Health Net, NOT Kaiser):");
  console.log(`  worker   : ${eligibleWorker} ([KAISER] 24mo Medical (Health Net))`);
  console.log(`  history  : Health Net 2024-01 → ${fmt(windowEnd)} (+${s1Created} new rows)`);
  console.log("  expect   : Start Kaiser => ELIGIBLE (continuous medical)\n");

  console.log("Scenario 2 — only 6 months of medical (Health Net, NOT Kaiser):");
  console.log(`  worker   : ${sixMonthWorker} ([KAISER] 6mo Medical (Health Net))`);
  console.log(`  history  : Health Net 2025-12 → ${fmt(windowEnd)} (+${s2Created} new rows)`);
  console.log("  expect   : Start Kaiser => NOT eligible (18 of 24 months uncovered)\n");

  console.log("Scenario 3 — Kaiser historically (not currently), < 24 mo medical:");
  console.log(`  worker   : ${kaiserHistoricalWorker} ([KAISER] Kaiser historical, <24mo medical)`);
  console.log(`  history  : Kaiser 2024-01 → 2024-06 (+${s3Created} new rows)`);
  console.log("  expect   : Start Kaiser => NOT eligible (far fewer than 24 medical months)\n");

  console.log(
    "Verify in the app: open a worker -> Benefits -> Eligibility, choose the\n" +
      'EVENT CENTER Plan policy and the Kaiser benefit, scan type "start", as-of\n' +
      "June 2026, run the check, and read the 'BAO - Start Kaiser' result row.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
