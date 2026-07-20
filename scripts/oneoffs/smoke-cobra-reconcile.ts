/**
 * One-off smoke test: run COBRA case reconciliation against the seeded
 * "[WMB TERM TEST]" workers (seed-wmb-terminate-cases.ts +
 * smoke-wmb-terminate-events.ts must have run so July 2026 terminate
 * events exist) and verify:
 *
 *   1. dry-run reports what it would create without writing,
 *   2. a live run creates ONE case per failing worker for July 2026
 *      (Low April, Zero April) and none for the control (OK April),
 *   3. a second live run creates nothing (idempotent).
 *
 * Usage: npx tsx scripts/oneoffs/smoke-cobra-reconcile.ts
 */

import { storage } from "../../server/storage/database";
import { loadComponentCache } from "../../server/services/component-cache";
import "../../server/plugins/trust/eligibility";
import { reconcileCobraCases } from "../../server/services/bao-cobra-case-reconcile";

const JULY_YMD = "2026-07-01";

const CASES: Array<{ name: string; expectCase: boolean }> = [
  { name: "[WMB TERM TEST] Low April", expectCase: true },
  { name: "[WMB TERM TEST] Zero April", expectCase: true },
  { name: "[WMB TERM TEST] OK April", expectCase: false },
];

async function workerIdByName(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (!exact) throw new Error(`Test worker not found: ${name}`);
  return exact.id;
}

async function julyCases(workerId: string) {
  return storage.baoCobraCases.listForCoveredPersonEffective(workerId, JULY_YMD);
}

async function main(): Promise<void> {
  await loadComponentCache();
  let failures = 0;

  const workers: Array<{ name: string; id: string; expectCase: boolean }> = [];
  for (const c of CASES) {
    workers.push({ name: c.name, id: await workerIdByName(c.name), expectCase: c.expectCase });
  }

  // Baseline counts (cases may exist from prior runs).
  const before = new Map<string, number>();
  for (const w of workers) {
    before.set(w.id, (await julyCases(w.id)).length);
  }

  // 1. Dry run: must not write.
  const dry = await reconcileCobraCases({ dryRun: true });
  console.log("Dry run:", JSON.stringify(dry));
  for (const w of workers) {
    const now = (await julyCases(w.id)).length;
    if (now !== before.get(w.id)) {
      failures++;
      console.log(`  DRY-RUN WROTE for ${w.name}!`);
    }
  }

  // 2. Live run.
  const live1 = await reconcileCobraCases();
  console.log("Live run 1:", JSON.stringify(live1));

  for (const w of workers) {
    const cases = await julyCases(w.id);
    const got = cases.length > 0;
    const ok = got === w.expectCase && cases.length <= 1;
    if (!ok) failures++;
    console.log("");
    console.log(w.name);
    console.log(`  July 2026 case(s): ${cases.length} (expected ${w.expectCase ? 1 : 0})`);
    if (cases[0]) {
      const c = cases[0].theCase;
      console.log(`  medicalBenefitLostId: ${c.medicalBenefitLostId}`);
      console.log(`  dentalBenefitLostId : ${c.dentalBenefitLostId}`);
      console.log(`  source              : ${c.source}`);
    }
    console.log(`  result            : ${ok ? "OK" : "MISMATCH"}`);
  }

  // 3. Idempotency: second live run creates nothing.
  const live2 = await reconcileCobraCases();
  console.log("");
  console.log("Live run 2:", JSON.stringify(live2));
  if (live2.created !== 0 || live2.merged !== 0) {
    failures++;
    console.log("  NOT IDEMPOTENT: second run created or merged cases.");
  }

  console.log("");
  console.log(failures === 0 ? "Smoke test PASSED." : `Smoke test FAILED: ${failures} problem(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
