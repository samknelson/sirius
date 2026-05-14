#!/usr/bin/env npx tsx
/**
 * Smoke test for the ageout eligibility plugin's backward-compat handling
 * of legacy `{ minAge, maxAge }` configs and the new fractional
 * `{ minYears, minMonths, maxYears, maxMonths, warn* }` shape.
 *
 * Run: npx tsx scripts/smoke-test-ageout-legacy.ts
 */
import { AgeoutPlugin } from "../server/plugins/trust/eligibility/plugins/ageout";
import type { EligibilityContext } from "../server/plugins/trust/eligibility/types";

const plugin = new AgeoutPlugin();

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

function ctx(birthDate: string, asOfYear: number, asOfMonth: number): EligibilityContext {
  return {
    scanType: "start",
    workerId: "smoke-worker",
    asOfYear,
    asOfMonth,
    getWorker: async () => ({ id: "smoke-worker" }) as never,
    getContact: async () => ({ birthDate }) as never,
  } as EligibilityContext;
}

function evalAt(
  config: Record<string, unknown>,
  birthDate: string,
  y: number,
  m: number,
) {
  return plugin.evaluate(ctx(birthDate, y, m), config as never);
}

async function run() {
  console.log("Legacy minAge: 18");
  {
    const c = { minAge: 18 };
    const r1 = await evalAt(c, "2008-05-15", 2026, 5);
    check("18y0m worker is eligible", r1.eligible === true && !r1.warning, r1);
    const r2 = await evalAt(c, "2008-06-01", 2026, 5);
    check("17y11m worker is NOT eligible", r2.eligible === false, r2);
  }

  console.log("Legacy maxAge: 65");
  {
    const c = { maxAge: 65 };
    const r1 = await evalAt(c, "1960-06-01", 2026, 5);
    check("65y11m worker is eligible (legacy floor)", r1.eligible === true, r1);
    const r2 = await evalAt(c, "1960-05-15", 2026, 5);
    check("66y0m worker is NOT eligible", r2.eligible === false, r2);
    const r3 = await evalAt(c, "1961-05-15", 2026, 5);
    check("65y0m worker is eligible", r3.eligible === true, r3);
  }

  console.log("Day-of-month is ignored");
  {
    const c = { minYears: 18, minMonths: 0 };
    const dayFirst = await evalAt(c, "2008-05-01", 2026, 5);
    const dayLast = await evalAt(c, "2008-05-31", 2026, 5);
    check(
      "Birth day does not shift evaluation",
      dayFirst.eligible === dayLast.eligible &&
        dayFirst.reason === dayLast.reason,
      { dayFirst, dayLast },
    );
  }

  console.log("New fractional bounds");
  {
    const c = { minYears: 18, minMonths: 6, maxYears: 65, maxMonths: 0 };
    const below = await evalAt(c, "2007-12-15", 2026, 5);
    check("18y5m below min is NOT eligible", below.eligible === false, below);
    const atMin = await evalAt(c, "2007-11-15", 2026, 5);
    check("18y6m at min is eligible", atMin.eligible === true, atMin);
    const above = await evalAt(c, "1961-04-01", 2026, 5);
    check("65y1m above max is NOT eligible", above.eligible === false, above);
  }

  console.log("Inner warning band");
  {
    const c = {
      minYears: 18,
      minMonths: 0,
      maxYears: 65,
      maxMonths: 0,
      warnMinYears: 19,
      warnMinMonths: 0,
      warnMaxYears: 64,
      warnMaxMonths: 0,
    };
    const lowEdge = await evalAt(c, "2007-11-15", 2026, 5);
    check(
      "18y6m is eligible with approaching-min warning",
      lowEdge.eligible === true &&
        typeof lowEdge.warning === "string" &&
        lowEdge.warning.includes("approaching minimum"),
      lowEdge,
    );
    const highEdge = await evalAt(c, "1961-11-15", 2026, 5);
    check(
      "64y6m is eligible with approaching-max warning",
      highEdge.eligible === true &&
        typeof highEdge.warning === "string" &&
        highEdge.warning.includes("approaching maximum"),
      highEdge,
    );
    const middle = await evalAt(c, "1996-05-15", 2026, 5);
    check(
      "30y0m is eligible with no warning",
      middle.eligible === true && !middle.warning,
      middle,
    );
  }

  console.log("Invalid configs fail closed");
  {
    const r1 = await evalAt({ minYears: 30, maxYears: 20 }, "1990-05-15", 2026, 5);
    check(
      "min > max is rejected at evaluate",
      r1.eligible === false &&
        typeof r1.reason === "string" &&
        r1.reason.toLowerCase().includes("invalid"),
      r1,
    );
    const r2 = await evalAt(
      { minYears: 18, maxYears: 65, warnMinYears: 17 },
      "1990-05-15",
      2026,
      5,
    );
    check(
      "warnMin below eligible min is rejected",
      r2.eligible === false &&
        typeof r2.reason === "string" &&
        r2.reason.toLowerCase().includes("invalid"),
      r2,
    );
  }

  console.log("Output formatting");
  {
    const r = await evalAt({ minYears: 18, maxYears: 65 }, "1972-05-15", 2026, 5);
    check(
      "reason uses 'years' / 'months' words",
      typeof r.reason === "string" && /\d+\s+years?/.test(r.reason),
      r,
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll ageout legacy/fractional smoke checks passed.");
}

run().catch((err) => {
  console.error("Smoke test threw:", err);
  process.exit(1);
});
