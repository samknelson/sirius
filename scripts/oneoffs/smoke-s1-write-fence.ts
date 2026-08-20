/**
 * Real-Postgres concurrency smoke for the S1 app-write fence.
 *
 * Run:
 *   npx tsx scripts/oneoffs/smoke-s1-write-fence.ts
 *
 * Uses the configured application database only for advisory locks. Scheduler
 * run storage and WMB queue storage are stubbed in memory, so no application
 * rows are created or changed.
 */
import express from "express";
import type { AddressInfo } from "net";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage";
import {
  acquireExclusiveAppWriteFence,
  endAppWriteFencePool,
  tryAcquireAppWriteFence,
  type AppWriteFenceLease,
} from "../../server/services/s1-write-fence";
import {
  createS1WriteFenceMiddleware,
  installS1WriteFenceHandlerTracking,
} from "../../server/middleware/s1-write-fence";
import { cronScheduler, type ScheduledCronJob } from "../../server/cron/scheduler";
import {
  processNextQueueJob,
  tryImmediateScan,
} from "../../server/services/wmb-scan-queue";
import { finalizeWriteFenceReport } from "../s1-migration/lib/write-fence-report";

let passed = 0;

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function within<T>(promise: Promise<T>, label: string, ms = 3_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mustAcquireShared(): Promise<AppWriteFenceLease> {
  const lease = await tryAcquireAppWriteFence();
  if (!lease) throw new Error("Expected shared fence lease, but an external wet sync owns it");
  return lease;
}

async function lockManagerScenarios(): Promise<void> {
  console.log("\n1. Existing app work delays the exclusive sync fence");
  const first = await mustAcquireShared();
  const second = await mustAcquireShared();
  let exclusive: AppWriteFenceLease | undefined;
  try {
    let acquired = false;
    const waiting = acquireExclusiveAppWriteFence().then((lease) => {
      acquired = true;
      return lease;
    });
    await sleep(100);
    check(!acquired, "exclusive fence waits behind multiple shared app leases");
    await first.release();
    await sleep(100);
    check(!acquired, "exclusive fence still waits until the last app lease finishes");
    await second.release();
    exclusive = await within(waiting, "exclusive acquisition after app work");
    check(acquired, "exclusive fence acquires after all in-flight app work");
  } finally {
    await first.release();
    await second.release();
    await exclusive?.release();
  }

  console.log("\n2. A queued sync prevents late app work from barging");
  const existing = await mustAcquireShared();
  let waitingExclusive: AppWriteFenceLease | undefined;
  try {
    let acquired = false;
    const waiting = acquireExclusiveAppWriteFence().then((lease) => {
      acquired = true;
      return lease;
    });
    await sleep(100);
    check(!acquired, "exclusive waiter is queued behind existing app work");
    const late = await tryAcquireAppWriteFence();
    check(late === undefined, "new shared work is refused once an exclusive waiter is queued");
    await existing.release();
    waitingExclusive = await within(waiting, "queued exclusive fairness");
  } finally {
    await existing.release();
    await waitingExclusive?.release();
  }

  console.log("\n3. Fence leases do not consume the handler storage pool");
  const leases: AppWriteFenceLease[] = [];
  try {
    for (let i = 0; i < 12; i++) leases.push(await mustAcquireShared());
    const result = await within(pool.query("SELECT 1 AS ok"), "main pool query under fence load");
    check(result.rows[0]?.ok === 1, "main storage pool remains available with many live fence leases");
  } finally {
    await Promise.all(leases.map((held) => held.release()));
  }

  console.log("\n4. Locks release after injected app-work and unlock failures");
  const lease = await mustAcquireShared();
  try {
    throw new Error("injected app work failure");
  } catch {
    // Expected. The finally below models request/scheduler cleanup.
  } finally {
    await lease.release();
  }
  const afterFailure = await within(
    acquireExclusiveAppWriteFence(),
    "exclusive acquisition after injected failure",
  );
  check(Boolean(afterFailure), "injected failure does not strand a shared lease");
  await afterFailure.release();

  let discardedWithError = false;
  const fakeClient = {
    calls: 0,
    async query() {
      this.calls++;
      if (this.calls === 1) return { rows: [{ got: true }] };
      throw new Error("injected unlock failure");
    },
    release(error?: Error | boolean) {
      discardedWithError = error instanceof Error;
    },
  };
  const failedUnlockLease = await tryAcquireAppWriteFence({
    connect: async () => fakeClient as any,
  });
  let unlockThrew = false;
  try {
    await failedUnlockLease?.release();
  } catch {
    unlockThrew = true;
  }
  check(unlockThrew && discardedWithError, "unlock failure discards the session instead of pooling it");
}

interface HttpHarness {
  baseUrl: string;
  releaseHeldMutation(): void;
  heldMutationEntered: Promise<void>;
  abortedMutationEntered: Promise<void>;
  abortedMutationSettled: Promise<void>;
  releaseAbortedMutation(): void;
  counters: { reads: number; mutations: number; options: number };
  close(): Promise<void>;
}

async function startHttpHarness(): Promise<HttpHarness> {
  const app = express();
  const counters = { reads: 0, mutations: 0, options: 0 };
  let entered!: () => void;
  let abortEntered!: () => void;
  let releaseHeld!: () => void;
  const heldMutationEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  const abortedMutationEntered = new Promise<void>((resolve) => {
    abortEntered = resolve;
  });
  let abortSettled!: () => void;
  let releaseAbort!: () => void;
  const abortedMutationSettled = new Promise<void>((resolve) => {
    abortSettled = resolve;
  });
  const abortHeld = new Promise<void>((resolve) => {
    releaseAbort = resolve;
  });

  app.use(createS1WriteFenceMiddleware());
  installS1WriteFenceHandlerTracking(app);
  app.get("/read", (_req, res) => {
    counters.reads++;
    res.json({ ok: true });
  });
  app.options("/read", (_req, res) => {
    counters.options++;
    res.sendStatus(204);
  });
  app.post("/mutate", (_req, res) => {
    counters.mutations++;
    res.json({ changed: true });
  });
  app.post("/hold", async (_req, res) => {
    counters.mutations++;
    entered();
    await held;
    res.json({ changed: true });
  });
  app.post("/fail", (_req, _res, next) => {
    counters.mutations++;
    next(new Error("injected handler failure"));
  });
  app.post("/abort", async (_req, _res) => {
    counters.mutations++;
    abortEntered();
    // Deliberately continue asynchronous mutation work after the client
    // disconnects. The sync must still wait for this returned handler promise.
    await abortHeld;
    abortSettled();
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: "injected failure" });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    counters,
    heldMutationEntered,
    abortedMutationEntered,
    abortedMutationSettled,
    releaseAbortedMutation: releaseAbort,
    releaseHeldMutation: releaseHeld,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      // Do not let a deliberately aborted smoke request or undici keep-alive
      // socket hide the original assertion by hanging test cleanup.
      server.closeAllConnections();
    }),
  };
}

async function httpScenarios(harness: HttpHarness): Promise<void> {
  console.log("\n5. Active wet sync keeps reads online and rejects new mutations");
  const exclusive = await acquireExclusiveAppWriteFence();
  try {
    const get = await fetch(`${harness.baseUrl}/read`);
    check(get.status === 200, "GET continues normally under the exclusive fence");
    const head = await fetch(`${harness.baseUrl}/read`, { method: "HEAD" });
    check(head.status === 200, "HEAD continues normally under the exclusive fence");
    const options = await fetch(`${harness.baseUrl}/read`, { method: "OPTIONS" });
    check(options.status === 204, "OPTIONS continues normally under the exclusive fence");

    const post = await fetch(`${harness.baseUrl}/mutate`, { method: "POST" });
    const body = await post.json() as { code?: string; message?: string };
    check(post.status === 503, "mutating HTTP request receives retryable 503");
    check(post.headers.get("retry-after") === "60", "503 includes stable Retry-After");
    check(
      body.code === "S1_SYNC_WRITE_FENCE" && body.message?.includes("temporarily paused"),
      "503 has stable code and clear user-facing message",
    );
    check(harness.counters.mutations === 0, "rejected mutation never reaches its handler");

    await deferredSchedulerScenario();
    await deferredWmbScenario();
  } finally {
    await exclusive.release();
  }

  console.log("\n6. In-flight HTTP work delays sync and response failures release");
  let syncLease: AppWriteFenceLease | undefined;
  const heldRequest = fetch(`${harness.baseUrl}/hold`, { method: "POST" });
  await within(harness.heldMutationEntered, "held mutation enters handler");
  let syncAcquired = false;
  const waitingSync = acquireExclusiveAppWriteFence().then((lease) => {
    syncAcquired = true;
    return lease;
  });
  await sleep(100);
  check(!syncAcquired, "sync waits for an already-running mutation handler");
  harness.releaseHeldMutation();
  check((await heldRequest).status === 200, "in-flight mutation completes normally");
  syncLease = await within(waitingSync, "sync after held HTTP mutation");
  check(syncAcquired, "sync acquires immediately after response completion");
  await syncLease.release();

  const failed = await fetch(`${harness.baseUrl}/fail`, { method: "POST" });
  check(failed.status === 500, "injected request-handler failure is returned");
  const afterHandlerFailure = await within(
    acquireExclusiveAppWriteFence(),
    "sync after handler failure",
  );
  check(Boolean(afterHandlerFailure), "handler failure releases its shared fence");
  await afterHandlerFailure.release();

  const abortController = new AbortController();
  const abortedRequest = fetch(`${harness.baseUrl}/abort`, {
    method: "POST",
    signal: abortController.signal,
  }).catch(() => undefined);
  await within(harness.abortedMutationEntered, "aborted mutation enters handler");
  abortController.abort();
  await abortedRequest;
  let afterAbortAcquired = false;
  const waitingAfterAbort = acquireExclusiveAppWriteFence().then((lease) => {
    afterAbortAcquired = true;
    return lease;
  });
  await sleep(100);
  check(!afterAbortAcquired, "client abort does not release while async handler work continues");
  harness.releaseAbortedMutation();
  await within(harness.abortedMutationSettled, "aborted handler settles");
  const afterAbort = await within(waitingAfterAbort, "sync after aborted handler settles");
  check(Boolean(afterAbort), "fence releases after the aborted request's handler settles");
  await afterAbort.release();
}

async function deferredSchedulerScenario(): Promise<void> {
  const createOriginal = storage.cronJobRuns.create;
  const updateOriginal = storage.cronJobRuns.update;
  const writes: Array<Record<string, unknown>> = [];
  try {
    (storage.cronJobRuns as any).create = async (value: Record<string, unknown>) => {
      writes.push({ op: "create", ...value });
      return { id: "fence-smoke-run", ...value };
    };
    (storage.cronJobRuns as any).update = async (_id: string, value: Record<string, unknown>) => {
      writes.push({ op: "update", ...value });
      return { id: "fence-smoke-run", ...value };
    };
    const unknownJob: ScheduledCronJob = {
      configId: "fence-smoke-config",
      name: "fence-smoke-unregistered",
      schedule: "* * * * *",
      enabled: true,
      settings: {},
    };
    // If the plugin body were reached, this unknown plugin would throw.
    await cronScheduler.executeJob(unknownJob, false);
    const terminal = writes.find((write) => write.op === "update");
    const output = JSON.parse(String(terminal?.output ?? "{}")) as { reason?: string };
    check(
      writes[0]?.status === "skipped" && terminal?.status === "skipped",
      "scheduler records sync-deferred work as skipped, not failed",
    );
    check(
      output.reason === "s1-sync-deferred" && terminal?.error === undefined,
      "scheduler deferral has an explicit reason and consumes no failure budget",
    );
  } finally {
    (storage.cronJobRuns as any).create = createOriginal;
    (storage.cronJobRuns as any).update = updateOriginal;
  }
}

async function deferredWmbScenario(): Promise<void> {
  let claims = 0;
  const fakeStorage = {
    wmbScanQueue: {
      claimNextJob: async () => {
        claims++;
        return undefined;
      },
      claimJobById: async () => {
        claims++;
        return undefined;
      },
    },
  } as any;

  const cron = await processNextQueueJob(fakeStorage);
  const immediate = await tryImmediateScan(fakeStorage, "worker-fence-smoke", ["queue-fence-smoke"]);
  check(!cron.processed, "WMB cron path defers before claiming queue work");
  check(
    !immediate.ran && immediate.deferredReason === "s1-sync",
    "immediate WMB path reports sync deferral",
  );
  check(claims === 0, "WMB jobs remain pending because neither path claims");
}

async function schedulerFailureCleanupScenario(): Promise<void> {
  console.log("\n7. WMB race, scheduler failure cleanup, and a second wet run");
  await wmbClaimRaceScenario();
  const createOriginal = storage.cronJobRuns.create;
  const updateOriginal = storage.cronJobRuns.update;
  try {
    (storage.cronJobRuns as any).create = async (value: Record<string, unknown>) => ({
      id: "fence-smoke-failure-run",
      ...value,
    });
    (storage.cronJobRuns as any).update = async (_id: string, value: Record<string, unknown>) => ({
      id: "fence-smoke-failure-run",
      ...value,
    });
    const unknownJob: ScheduledCronJob = {
      configId: "fence-smoke-failure-config",
      name: "fence-smoke-unregistered-failure",
      schedule: "* * * * *",
      enabled: true,
      settings: {},
    };
    let threw = false;
    try {
      await cronScheduler.executeJob(unknownJob, false);
    } catch {
      threw = true;
    }
    check(threw, "injected scheduler/plugin failure propagates normally");
  } finally {
    (storage.cronJobRuns as any).create = createOriginal;
    (storage.cronJobRuns as any).update = updateOriginal;
  }

  const firstWet = await within(
    acquireExclusiveAppWriteFence(),
    "wet fence after scheduler failure",
  );
  check(Boolean(firstWet), "scheduler failure does not strand its shared fence");
  await firstWet.release();
  const secondWet = await within(
    acquireExclusiveAppWriteFence(),
    "second wet run after release",
  );
  check(Boolean(secondWet), "a second wet run acquires after the first releases");
  await secondWet.release();

  const releaseFailures: string[] = [];
  const cleanupReport: Record<string, unknown> = {
    result: "PASS",
    writeFence: { status: "acquired" },
  };
  await finalizeWriteFenceReport(
    {
      release: async () => {
        throw new Error("injected exclusive unlock failure");
      },
    },
    cleanupReport,
    releaseFailures,
  );
  check(
    cleanupReport.result === "FAIL" &&
      (cleanupReport.writeFence as { releaseStatus?: string }).releaseStatus === "failed" &&
      releaseFailures.length === 1,
    "exclusive unlock failure produces a terminal FAIL report",
  );
}

async function wmbClaimRaceScenario(): Promise<void> {
  let processEntered!: () => void;
  let releaseProcessing!: () => void;
  const entered = new Promise<void>((resolve) => {
    processEntered = resolve;
  });
  const continueProcessing = new Promise<void>((resolve) => {
    releaseProcessing = resolve;
  });
  let claims = 0;
  const fakeJob = {
    id: "queue-race",
    workerId: "worker-race",
    month: 8,
    year: 2026,
    triggerSource: "worker_update",
  } as any;
  const fakeStorage = {
    wmbScanQueue: {
      claimNextJob: async () => {
        claims++;
        return fakeJob;
      },
    },
  } as any;

  const processing = processNextQueueJob(fakeStorage, undefined, undefined, {
    processJob: async () => {
      processEntered();
      await continueProcessing;
      return { processed: true, workerId: "worker-race", success: true };
    },
  });
  await within(entered, "WMB processing after claim");
  let syncAcquired = false;
  const waitingSync = acquireExclusiveAppWriteFence().then((lease) => {
    syncAcquired = true;
    return lease;
  });
  await sleep(100);
  check(claims === 1 && !syncAcquired, "claimed WMB work finishes while the wet sync waits");
  releaseProcessing();
  const result = await processing;
  check(result.processed && result.success, "in-flight WMB work completes without a stuck processing row");
  const sync = await within(waitingSync, "sync after WMB processing");
  check(syncAcquired, "sync acquires after in-flight WMB processing releases");
  await sync.release();
}

async function signalSessionCleanupScenario(): Promise<void> {
  console.log("\n8. Signal-driven process loss releases the PostgreSQL session lock");
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath, "--signal-holder"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  await within(
    new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (output.includes("SIGNAL_HOLDER_READY")) {
          clearInterval(poll);
          resolve();
        } else if (child.exitCode !== null) {
          clearInterval(poll);
          reject(new Error(`signal holder exited before ready: ${output.slice(-500)}`));
        }
      }, 20);
    }),
    "signal holder readiness",
    15_000,
  );
  child.kill("SIGTERM");
  await within(
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    "signal holder exit",
  );
  const afterSignal = await within(
    acquireExclusiveAppWriteFence(),
    "exclusive after signal-driven session loss",
    5_000,
  );
  check(Boolean(afterSignal), "PostgreSQL releases the holder's shared lock after SIGTERM");
  await afterSignal.release();
}

async function runSignalHolder(): Promise<void> {
  await mustAcquireShared();
  console.log("SIGNAL_HOLDER_READY");
  await new Promise<void>(() => {
    // Stay alive until the parent sends SIGTERM. There is intentionally no
    // cleanup handler: this proves PostgreSQL session-loss cleanup.
  });
}

async function main(): Promise<void> {
  const harness = await startHttpHarness();
  try {
    await lockManagerScenarios();
    await httpScenarios(harness);
    await schedulerFailureCleanupScenario();
    await signalSessionCleanupScenario();
    console.log(`\n${passed} write-fence checks passed`);
  } finally {
    harness.releaseHeldMutation();
    await harness.close();
    await endAppWriteFencePool();
    await pool.end();
  }
}

const entrypoint = process.argv.includes("--signal-holder") ? runSignalHolder : main;
entrypoint().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});