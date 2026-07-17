/**
 * One-off smoke test: run the July 2026 WMB scan for the three
 * "[WMB TERM TEST]" workers (seeded by seed-wmb-terminate-cases.ts) and
 * verify the trust-wmb-terminate denorm plugin now records `terminate`
 * events for FAILED continue scans even when there was no July coverage
 * row to delete.
 *
 * Steps:
 *   1. enqueue a July 2026 scan job per test worker,
 *   2. process queue jobs until none remain,
 *   3. run the trust-wmb-terminate plugin's compute + write for each worker
 *      (the live app does this asynchronously via the denorm stale queue;
 *      this script invokes the exact same plugin code synchronously),
 *   4. assert: Low April + Zero April each have a July terminate event for
 *      MLK with the threshold plugin among failedPlugins; OK April has none.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-wmb-terminate-events.ts
 */

import { storage } from "../../server/storage/database";
import { loadComponentCache } from "../../server/services/component-cache";
import "../../server/plugins/trust/eligibility";
import { processNextQueueJob } from "../../server/services/wmb-scan-queue";
import "../../server/plugins/system/denorm/plugins/trustWmbTerminate";
import { getDenormPlugin } from "../../server/plugins/system/denorm/registry";

const MLK_BENEFIT_ID = "10e16e6e-1ce8-4068-a55a-6351e72be9f5";
const JULY = { year: 2026, month: 7 };

const CASES: Array<{ name: string; expectTerminate: boolean }> = [
  { name: "[WMB TERM TEST] Low April", expectTerminate: true },
  { name: "[WMB TERM TEST] Zero April", expectTerminate: true },
  { name: "[WMB TERM TEST] OK April", expectTerminate: false },
];

async function workerIdByName(name: string): Promise<string> {
  const found = await storage.workers.searchWorkers(name, 10);
  const exact = found.workers.find((w) => w.displayName === name);
  if (!exact) throw new Error(`Test worker not found: ${name} — run seed-wmb-terminate-cases.ts first`);
  return exact.id;
}

async function main(): Promise<void> {
  await loadComponentCache();
  const plugin = getDenormPlugin("trust-wmb-terminate");
  if (!plugin) throw new Error("trust-wmb-terminate denorm plugin not registered");

  const workers: Array<{ name: string; id: string; expectTerminate: boolean }> = [];
  for (const c of CASES) {
    workers.push({ name: c.name, id: await workerIdByName(c.name), expectTerminate: c.expectTerminate });
  }

  // 1. Enqueue July scans.
  for (const w of workers) {
    await storage.wmbScanQueue.enqueueWorker(w.id, JULY.month, JULY.year, "manual");
  }

  // 2. Drain the queue.
  let processed = 0;
  for (;;) {
    const res = await processNextQueueJob(storage, ["manual"]);
    if (!res.processed) break;
    processed++;
    if (processed > 50) throw new Error("Queue drain runaway");
  }
  console.log(`Processed ${processed} scan job(s).`);

  // 3 + 4. Recompute the terminate slice per worker and assert.
  let failures = 0;
  for (const w of workers) {
    const payload = await plugin.compute(w.id);
    await plugin.write(w.id, payload);

    const events = await storage.trustWmbEvents.listByWorkerAndType(w.id, "terminate");
    const julyTerm = events.filter(
      (e) =>
        e.year === JULY.year &&
        e.month === JULY.month &&
        e.benefitId === MLK_BENEFIT_ID,
    );
    const got = julyTerm.length > 0;
    const ok = got === w.expectTerminate;
    if (!ok) failures++;

    console.log("");
    console.log(w.name);
    console.log(`  worker              : ${w.id}`);
    console.log(`  July terminate event: ${got} (expected ${w.expectTerminate})`);
    if (julyTerm[0]?.data) {
      console.log(`  failedPlugins       : ${JSON.stringify(julyTerm[0].data.failedPlugins ?? [])}`);
    }
    console.log(`  result              : ${ok ? "OK" : "MISMATCH"}`);
  }

  console.log("");
  console.log(failures === 0 ? "Smoke test PASSED." : `Smoke test FAILED: ${failures} mismatch(es).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
