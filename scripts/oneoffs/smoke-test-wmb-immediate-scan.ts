/**
 * Smoke test for the immediate WMB scan fast path (rate-capped via the flood
 * framework). Run with: npx tsx scripts/oneoffs/smoke-test-wmb-immediate-scan.ts
 *
 * No real DB queries: flood counting and queue claiming are stubbed in-memory
 * on the storage singleton (the flood service and tryImmediateScan hold a
 * reference to the same object, so reassigning methods works).
 *
 * Covers:
 *  1. Under-budget enqueue scans immediately (claims + processes the job).
 *  2. Over-budget (global cap) enqueue defers to cron.
 *  3. Same worker twice within a minute defers the second.
 *  4. Flood-check error defers safely (fail open toward cron).
 *  5. Cap 0 disables the fast path entirely.
 *  6. Cron never double-processes a job the immediate path claimed (and vice
 *     versa: an already-claimed job is skipped by the immediate path).
 */

// Import order matters: initialize the storage module graph the way the app
// boots, BEFORE anything that touches plugin registries.
import { storage } from "../../server/storage";
import {
  registerFloodEvents,
  loadFloodConfigFromVariables,
} from "../../server/flood/events";
import { floodEventRegistry } from "../../server/flood/registry";
import {
  tryImmediateScan,
  processClaimedJob,
} from "../../server/services/wmb-scan-queue";
import {
  WMB_IMMEDIATE_SCAN_FLOOD_EVENT,
  WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT,
} from "../../server/flood/events";
import type { TrustWmbScanQueue } from "@shared/schema";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory flood storage stub
// ---------------------------------------------------------------------------
interface FloodRow {
  event: string;
  identifier: string;
  at: number;
}
let floodRows: FloodRow[] = [];
let floodCountShouldThrow = false;

(storage.flood as any).countEventsInWindow = async (
  event: string,
  identifier: string,
  windowStart: Date,
): Promise<number> => {
  if (floodCountShouldThrow) throw new Error("simulated flood storage outage");
  return floodRows.filter(
    (r) => r.event === event && r.identifier === identifier && r.at > windowStart.getTime(),
  ).length;
};
(storage.flood as any).recordFloodEvent = async (
  event: string,
  identifier: string,
  _expiresAt: Date,
): Promise<void> => {
  floodRows.push({ event, identifier, at: Date.now() });
};

// ---------------------------------------------------------------------------
// In-memory scan-queue stub (pending → processing claim semantics)
// ---------------------------------------------------------------------------
const jobs = new Map<string, TrustWmbScanQueue>();
let nextId = 1;

function enqueueFakeJob(workerId: string): string {
  const id = `job-${nextId++}`;
  jobs.set(id, {
    id,
    statusId: "status-1",
    workerId,
    month: 7,
    year: 2026,
    status: "pending",
    triggerSource: "worker_update",
    resultSummary: null,
    scheduledFor: null,
    pickedAt: null,
    completedAt: null,
    attempts: 0,
    lastError: null,
  } as unknown as TrustWmbScanQueue);
  return id;
}

(storage.wmbScanQueue as any).claimJobById = async (
  queueId: string,
): Promise<TrustWmbScanQueue | undefined> => {
  const job = jobs.get(queueId);
  if (!job || (job as any).status !== "pending") return undefined;
  (job as any).status = "processing";
  (job as any).attempts = ((job as any).attempts ?? 0) + 1;
  return { ...job };
};
(storage.wmbScanQueue as any).claimNextJob = async (): Promise<TrustWmbScanQueue | undefined> => {
  for (const job of jobs.values()) {
    if ((job as any).status === "pending") {
      (job as any).status = "processing";
      return { ...job };
    }
  }
  return undefined;
};

// Test seam: record which jobs the immediate path processed, and mark them
// terminal like the real processClaimedJob would (via recordJobResult).
const processedJobIds: string[] = [];
const fakeProcessJob: typeof processClaimedJob = async (_s, job) => {
  processedJobIds.push(job.id);
  const stored = jobs.get(job.id);
  if (stored) (stored as any).status = "success";
  return { processed: true, workerId: job.workerId, success: true };
};

function resetAll(): void {
  floodRows = [];
  floodCountShouldThrow = false;
  jobs.clear();
  processedJobIds.length = 0;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  registerFloodEvents();

  console.log("\n1. Under-budget enqueue scans immediately");
  {
    resetAll();
    const qid = enqueueFakeJob("worker-A");
    const out = await tryImmediateScan(storage, "worker-A", [qid], { processJob: fakeProcessJob });
    check("ran immediately", out.ran === true);
    check("claimed exactly the enqueued job", out.claimedJobs === 1 && processedJobIds[0] === qid);
    check("recorded worker flood event", floodRows.some((r) => r.event === WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT && r.identifier === "worker-A"));
    check("recorded global flood event", floodRows.some((r) => r.event === WMB_IMMEDIATE_SCAN_FLOOD_EVENT && r.identifier === "global"));
  }

  console.log("\n2. Over-budget (global cap) defers to cron");
  {
    resetAll();
    floodEventRegistry.updateConfig(WMB_IMMEDIATE_SCAN_FLOOD_EVENT, 2, 60);
    // Exhaust the global budget with two distinct workers.
    for (const w of ["w1", "w2"]) {
      const qid = enqueueFakeJob(w);
      await tryImmediateScan(storage, w, [qid], { processJob: fakeProcessJob });
    }
    const qid3 = enqueueFakeJob("w3");
    const out = await tryImmediateScan(storage, "w3", [qid3], { processJob: fakeProcessJob });
    check("third worker deferred", out.ran === false && out.deferredReason === "global-cap");
    check("deferred job stays pending for cron", (jobs.get(qid3) as any).status === "pending");
    check("no worker flood event recorded when deferred", !floodRows.some((r) => r.identifier === "w3"));
    floodEventRegistry.resetToDefaults(WMB_IMMEDIATE_SCAN_FLOOD_EVENT);
  }

  console.log("\n3. Same worker twice within a minute defers the second");
  {
    resetAll();
    const q1 = enqueueFakeJob("worker-B");
    const first = await tryImmediateScan(storage, "worker-B", [q1], { processJob: fakeProcessJob });
    const q2 = enqueueFakeJob("worker-B");
    const second = await tryImmediateScan(storage, "worker-B", [q2], { processJob: fakeProcessJob });
    check("first ran", first.ran === true);
    check("second deferred on worker cap", second.ran === false && second.deferredReason === "worker-cap");
    check("second job stays pending for cron", (jobs.get(q2) as any).status === "pending");
    check("worker-cap deferral did not consume global budget", floodRows.filter((r) => r.event === WMB_IMMEDIATE_SCAN_FLOOD_EVENT).length === 1);
  }

  console.log("\n4. Flood-check error defers safely (fail open toward cron)");
  {
    resetAll();
    floodCountShouldThrow = true;
    const qid = enqueueFakeJob("worker-C");
    const out = await tryImmediateScan(storage, "worker-C", [qid], { processJob: fakeProcessJob });
    check("deferred with flood-error reason", out.ran === false && out.deferredReason === "flood-error");
    check("job untouched (pending)", (jobs.get(qid) as any).status === "pending");
    check("nothing processed", processedJobIds.length === 0);
  }

  console.log("\n5. Cap 0 disables the fast path entirely");
  {
    resetAll();
    floodEventRegistry.updateConfig(WMB_IMMEDIATE_SCAN_FLOOD_EVENT, 0, 60);
    const qid = enqueueFakeJob("worker-D");
    const out = await tryImmediateScan(storage, "worker-D", [qid], { processJob: fakeProcessJob });
    check("disabled deferral", out.ran === false && out.deferredReason === "disabled");
    check("no flood rows written", floodRows.length === 0);
    check("job stays pending for cron", (jobs.get(qid) as any).status === "pending");
    floodEventRegistry.resetToDefaults(WMB_IMMEDIATE_SCAN_FLOOD_EVENT);
  }

  console.log("\n6. Claim exclusivity: no double-processing between cron and immediate path");
  {
    resetAll();
    // 6a. Immediate path claims first → cron's claimNextJob finds nothing.
    const q1 = enqueueFakeJob("worker-E");
    const out = await tryImmediateScan(storage, "worker-E", [q1], { processJob: fakeProcessJob });
    check("immediate path claimed + processed", out.ran === true && out.claimedJobs === 1);
    const cronJob = await storage.wmbScanQueue.claimNextJob();
    check("cron finds nothing to claim afterwards", cronJob === undefined);

    // 6b. Cron claims first → immediate path's claimJobById returns nothing.
    const q2 = enqueueFakeJob("worker-F");
    const claimedByCron = await storage.wmbScanQueue.claimNextJob();
    check("cron claimed the job", claimedByCron?.id === q2);
    const out2 = await tryImmediateScan(storage, "worker-F", [q2], { processJob: fakeProcessJob });
    check("immediate path ran but claimed zero jobs", out2.ran === true && out2.claimedJobs === 0);
    check("job not processed twice", processedJobIds.filter((id) => id === q2).length === 0);
  }

  console.log("\n7. A stored flood_<name> variable of threshold 0 disables the fast path end-to-end");
  {
    resetAll();
    // Simulate an admin having saved { threshold: 0 } via the flood-config
    // UI (persisted as the flood_wmb-immediate-scan variable), then a boot
    // that loads configs from variables.
    (storage.variables as any).getByName = async (name: string) => {
      if (name === `flood_${WMB_IMMEDIATE_SCAN_FLOOD_EVENT}`) {
        return { value: { threshold: 0, windowSeconds: 60 } };
      }
      return undefined;
    };
    await loadFloodConfigFromVariables();
    const def = floodEventRegistry.get(WMB_IMMEDIATE_SCAN_FLOOD_EVENT);
    check("loader applied explicit-zero threshold", def?.threshold === 0);
    const qid = enqueueFakeJob("worker-G");
    const out = await tryImmediateScan(storage, "worker-G", [qid], { processJob: fakeProcessJob });
    check("fast path disabled by loaded config", out.ran === false && out.deferredReason === "disabled");
    check("job stays pending for cron", (jobs.get(qid) as any).status === "pending");
    floodEventRegistry.resetToDefaults(WMB_IMMEDIATE_SCAN_FLOOD_EVENT);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
