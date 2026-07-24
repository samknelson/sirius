/**
 * Smoke test for the sitespecific-bao-start-delta eligibility plugin.
 * Stubs the storage singleton's worker-benefit history; no database needed.
 * Run: npx tsx scripts/oneoffs/smoke-bao-start-delta.ts
 */
import { storage } from "../../server/storage/database";
import { BaoStartDeltaPlugin } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-start-delta";
import type { EligibilityContext } from "../../server/plugins/trust/eligibility/types";

const DELTA_BENEFIT = "benefit-delta";
const LIBERTY_BENEFIT = "benefit-liberty";
const UHDC_BENEFIT = "benefit-uhdc";

const worker = (id: string) => ({ id, contactId: `contact-${id}` }) as any;

// Evaluated date: July 2026. Window for 24 months = Jul 2024 → Jun 2026.
const AS_OF = { asOfYear: 2026, asOfMonth: 7 };

function ctx(workerId: string): EligibilityContext {
  return {
    scanType: "start",
    ...AS_OF,
    subscriberWorker: worker(workerId),
    subscriberContact: null,
    dependentWorker: worker(workerId),
    dependentContact: null,
  };
}

type Row = { year: number; month: number; benefitId: string };

/** Rows of `benefitId` for `count` consecutive months ENDING at (endYear, endMonth). */
function run(benefitId: string, count: number, endYear: number, endMonth: number): Row[] {
  const rows: Row[] = [];
  let ord = endYear * 12 + (endMonth - 1);
  for (let i = 0; i < count; i++, ord--) {
    rows.push({
      year: Math.floor(ord / 12),
      month: (ord % 12) + 1,
      benefitId,
    });
  }
  return rows;
}

const historyByWorker: Record<string, Row[]> = {
  // One single Delta month, years ago.
  "prior-delta": [{ year: 2019, month: 3, benefitId: DELTA_BENEFIT }],
  // 24 consecutive Liberty months immediately preceding Jul 2026.
  "liberty-24": run(LIBERTY_BENEFIT, 24, 2026, 6),
  // 24 months mixing Liberty (older 12) and UHDC (newer 12).
  "mixed-24": [...run(LIBERTY_BENEFIT, 12, 2025, 6), ...run(UHDC_BENEFIT, 12, 2026, 6)],
  // Only 23 of the 24 required months (starts one month late).
  "liberty-23": run(LIBERTY_BENEFIT, 23, 2026, 6),
  // 24 months in span but with a gap at Jan 2026.
  "gap": run(LIBERTY_BENEFIT, 24, 2026, 6).filter((r) => !(r.year === 2026 && r.month === 1)),
  // Delta coverage only IN/after the as-of month (must not count as prior).
  "delta-asof-only": [
    { year: 2026, month: 7, benefitId: DELTA_BENEFIT },
    { year: 2026, month: 8, benefitId: DELTA_BENEFIT },
  ],
  // Brand-new worker: no history at all.
  "new-worker": [],
};

(storage as any).trust = {
  ...(storage as any).trust,
  wmb: {
    getWorkerBenefits: async (workerId: string) => historyByWorker[workerId] ?? [],
  },
};

const config = {
  appliesTo: ["start"] as ("start" | "continue")[],
  priorBenefits: { benefitIds: [DELTA_BENEFIT] },
  continuousBenefits: { benefitIds: [LIBERTY_BENEFIT, UHDC_BENEFIT], months: 24 },
};

const plugin = new BaoStartDeltaPlugin();
let failures = 0;

async function check(
  name: string,
  workerId: string,
  expectEligible: boolean,
  reasonPart?: string,
  cfg: any = config,
) {
  const res = await plugin.evaluate(ctx(workerId), cfg);
  const ok =
    res.eligible === expectEligible &&
    (!reasonPart || (res.reason ?? "").toLowerCase().includes(reasonPart.toLowerCase()));
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: eligible=${res.eligible}`);
  console.log(`     reason=${res.reason}\n`);
}

(async () => {
  await check("one prior Delta month → eligible", "prior-delta", true, "prior coverage");
  await check("24 consecutive Liberty months → eligible", "liberty-24", true, "continuous coverage");
  await check("24 months mixing Liberty + UHDC → eligible", "mixed-24", true, "continuous coverage");
  await check("23 of 24 months → NOT eligible", "liberty-23", false, "1 of the 24 preceding months");
  await check("gap month (Jan 2026) → NOT eligible", "gap", false, "Jan 2026");
  await check("Delta only in/after as-of month → NOT eligible", "delta-asof-only", false, "never held any of the selected benefits");
  await check("brand-new worker → NOT eligible, clear reason", "new-worker", false, "no criterion was met");

  // Prior criterion is multi-select: Liberty history counts when Liberty is
  // among the prior benefits.
  await check(
    "prior multi-select: Liberty history + [Delta, Liberty] prior config → eligible",
    "liberty-23",
    true,
    "prior coverage",
    { appliesTo: ["start"], priorBenefits: { benefitIds: [DELTA_BENEFIT, LIBERTY_BENEFIT] } },
  );

  // Configurable months: 12-month requirement passes for the 23-run worker.
  await check(
    "months=12 config: 23-month Liberty run → eligible",
    "liberty-23",
    true,
    "12 months preceding",
    { ...config, continuousBenefits: { benefitIds: [LIBERTY_BENEFIT], months: 12 } },
  );

  // Continuous criterion only counts the SELECTED benefits: a Liberty run
  // does not satisfy a UHDC-only selection.
  await check(
    "continuous benefit mismatch: Liberty run vs UHDC-only config → NOT eligible",
    "liberty-24",
    false,
    "preceding months had none of the selected benefits",
    { appliesTo: ["start"], continuousBenefits: { benefitIds: [UHDC_BENEFIT], months: 24 } },
  );

  // Unconfigured rule fails explicitly.
  await check(
    "no criteria configured → NOT eligible with explicit reason",
    "liberty-24",
    false,
    "no criterion configured",
    { appliesTo: ["start"] },
  );

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
