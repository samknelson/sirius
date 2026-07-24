/**
 * One-off smoke test: hours-impact horizon resolution and affected-month
 * expansion in the WMB auto-rescan service (task: queue future months
 * affected by hours changes).
 *
 * Covers:
 *  - resolveHoursImpactHorizon(): max across configured trust-eligibility
 *    rules, component gating, unknown-plugin rows ignored, cap at
 *    MAX_SPAN_MONTHS - 1 (11) for BAO Buildup's unbounded-within-cap impact.
 *  - affectedMonthsForHours(): edited month always included, span M..M+h,
 *    clamp to current month, future months keep single-month behavior,
 *    12-month cap never drops the edited month.
 *
 * The plugin-config search is stubbed on the storage singleton; no rows are
 * written. The component cache is loaded from the real dev DB (sitespecific.bao
 * is expected to be enabled there).
 *
 * Usage:
 *   npx tsx scripts/oneoffs/test-hours-impact-horizon.ts
 */

import { storage } from "../../server/storage/database";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
// Import plugin modules directly so they self-register (gbhet-legal is not
// imported by the eligibility index).
import "../../server/plugins/trust/eligibility/plugins/gbhetLegal";
import "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-threshold";
import "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-buildup";
import {
  resolveHoursImpactHorizon,
  affectedMonthsForHours,
  resetHoursHorizonCache,
} from "../../server/services/wmb-auto-rescan";

const CAP = 11; // MAX_SPAN_MONTHS - 1

type StubRow = { config: { pluginId: string; data: Record<string, unknown> } };

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS ${label}: ${a}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}: expected ${e}, got ${a}`);
  }
}

async function withConfigs<T>(rows: StubRow[], fn: () => Promise<T>): Promise<T> {
  const original = storage.pluginConfigs.search;
  (storage.pluginConfigs as any).search = async (kind: string) => {
    if (kind !== "trust-eligibility") throw new Error(`unexpected kind ${kind}`);
    return rows;
  };
  resetHoursHorizonCache();
  try {
    return await fn();
  } finally {
    (storage.pluginConfigs as any).search = original;
    resetHoursHorizonCache();
  }
}

function fmt(months: { month: number; year: number }[]): string[] {
  return months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`);
}

async function main(): Promise<void> {
  await loadComponentCache();
  const baoEnabled = isComponentEnabledSync("sitespecific.bao");
  const gbhetEnabled = isComponentEnabledSync("sitespecific.gbhet.legal");
  console.log(`Components: sitespecific.bao=${baoEnabled}, sitespecific.gbhet.legal=${gbhetEnabled}`);
  if (!baoEnabled) {
    console.error("sitespecific.bao must be enabled in dev for this test; aborting.");
    process.exit(1);
  }

  console.log("\n1. No configured rules -> horizon 0, old month scans itself only");
  await withConfigs([], async () => {
    check("horizon", await resolveHoursImpactHorizon(), 0);
    check(
      "affected(2021-01)",
      fmt(await affectedMonthsForHours({ month: 1, year: 2021 })),
      ["2021-01"],
    );
  });

  console.log("\n2. BAO Threshold only -> horizon 3 (reads month M-3)");
  await withConfigs(
    [{ config: { pluginId: "sitespecific-bao-threshold", data: {} } }],
    async () => {
      check("horizon", await resolveHoursImpactHorizon(), 3);
      check(
        "affected(2021-01)",
        fmt(await affectedMonthsForHours({ month: 1, year: 2021 })),
        ["2021-01", "2021-02", "2021-03", "2021-04"],
      );
    },
  );

  console.log("\n3. GBHET Legal (monthsOffset 6) -> gated by its component");
  await withConfigs(
    [{ config: { pluginId: "gbhet-legal", data: { monthsOffset: 6 } } }],
    async () => {
      check("horizon", await resolveHoursImpactHorizon(), gbhetEnabled ? 6 : 0);
    },
  );

  console.log("\n4. Unknown plugin id rows are ignored");
  await withConfigs(
    [{ config: { pluginId: "no-such-plugin", data: {} } }],
    async () => {
      check("horizon", await resolveHoursImpactHorizon(), 0);
    },
  );

  console.log("\n5. BAO Buildup -> unbounded impact capped at 11, edited month kept");
  await withConfigs(
    [{ config: { pluginId: "sitespecific-bao-buildup", data: { lagMonths: 3, breakMonths: 4 } } }],
    async () => {
      check("horizon", await resolveHoursImpactHorizon(), CAP);
      const months = fmt(await affectedMonthsForHours({ month: 1, year: 2021 }));
      check("affected(2021-01) length", months.length, 12);
      check("first month is edited month", months[0], "2021-01");
      check("last month", months[11], "2021-12");
    },
  );

  console.log("\n6. Mixed threshold + buildup -> max wins (11)");
  await withConfigs(
    [
      { config: { pluginId: "sitespecific-bao-threshold", data: {} } },
      { config: { pluginId: "sitespecific-bao-buildup", data: {} } },
    ],
    async () => {
      check("horizon", await resolveHoursImpactHorizon(), CAP);
    },
  );

  console.log("\n7. Clamping to the current month + future-month passthrough");
  await withConfigs(
    [{ config: { pluginId: "sitespecific-bao-threshold", data: {} } }],
    async () => {
      const now = new Date();
      const cur = { month: now.getMonth() + 1, year: now.getFullYear() };
      const prev = cur.month === 1 ? { month: 12, year: cur.year - 1 } : { month: cur.month - 1, year: cur.year };
      const next = cur.month === 12 ? { month: 1, year: cur.year + 1 } : { month: cur.month + 1, year: cur.year };
      // Horizon 3 from last month would reach 2 months into the future; the
      // span must clamp at the current month.
      check(
        "affected(prev month) clamps to now",
        fmt(await affectedMonthsForHours(prev)),
        fmt([prev, cur]),
      );
      // A future hours month keeps the old single-month behavior.
      check(
        "affected(next month) is itself",
        fmt(await affectedMonthsForHours(next)),
        fmt([next]),
      );
    },
  );

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
