import {
  eventBus,
  EventType,
  type HoursSavedPayload,
  type PaymentSavedPayload,
  type TrustElectionSavedPayload,
  type TrustExemptionSavedPayload,
  type WorkerMshSavedPayload,
} from "./event-bus";
import { onAfterCommit } from "../storage/transaction-context";
import { storage } from "../storage";
import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";
import { enqueueMonthScan, processNextQueueJob } from "./wmb-scan-queue";

const SERVICE_NAME = "wmb-auto-rescan";
const COMPONENT_ID = "trust.benefits";

/** Trigger sources owned by this service; the drainer only claims these. */
export const AUTO_TRIGGER_SOURCES = ["worker_update", "auto_hours_bulk"];

/** How long we buffer hours events before deciding worker-vs-employer scope. */
const HOURS_DEBOUNCE_MS = 5000;
/** At or above this many distinct workers in one employer/month bucket, we
 * collapse into a single employer-scoped run instead of per-worker entries. */
const BULK_WORKER_THRESHOLD = 10;

const handlerIds: string[] = [];

function componentActive(): boolean {
  return isCacheInitialized() && isComponentEnabledSync(COMPONENT_ID);
}

// ---------------------------------------------------------------------------
// Drainer: single-flight loop that processes only auto-enqueued jobs so it
// never steals work from a manually queued run's poller.
// ---------------------------------------------------------------------------

let draining = false;
let drainRequested = false;

function pokeDrainer(): void {
  drainRequested = true;
  if (draining) return;
  draining = true;
  void (async () => {
    try {
      while (drainRequested) {
        drainRequested = false;
        // Keep claiming until no auto job is pending.
        for (;;) {
          const result = await processNextQueueJob(storage, AUTO_TRIGGER_SOURCES);
          if (!result.processed) break;
        }
      }
    } catch (err) {
      logger.error("WMB auto-rescan drainer failed", {
        service: SERVICE_NAME,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      draining = false;
      // A poke may have landed between the last empty claim and the flag
      // reset; re-run if so.
      if (drainRequested) pokeDrainer();
    }
  })();
}

// ---------------------------------------------------------------------------
// Enqueue helpers
// ---------------------------------------------------------------------------

interface MonthRef {
  month: number;
  year: number;
}

function currentMonth(): MonthRef {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function monthFromYmd(ymd: string): MonthRef | null {
  const m = /^(\d{4})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) };
}

function dedupeMonths(months: (MonthRef | null)[]): MonthRef[] {
  const seen = new Set<string>();
  const out: MonthRef[] = [];
  for (const ref of months) {
    if (!ref) continue;
    const key = `${ref.year}-${ref.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

async function enqueueWorkerMonths(
  workerId: string,
  months: MonthRef[],
  reason: string,
): Promise<void> {
  let enqueued = false;
  for (const { month, year } of months) {
    try {
      // Skip if this worker/month is already waiting to be scanned.
      const existing = await storage.wmbScanQueue.getWorkerQueueEntry(workerId, month, year);
      if (existing && (existing.status === "pending" || existing.status === "processing")) {
        continue;
      }
      await storage.wmbScanQueue.enqueueWorker(workerId, month, year, "worker_update");
      enqueued = true;
      logger.info("Auto-enqueued WMB rescan for worker", {
        service: SERVICE_NAME,
        workerId,
        month,
        year,
        reason,
      });
    } catch (err) {
      logger.error("Failed to auto-enqueue WMB rescan", {
        service: SERVICE_NAME,
        workerId,
        month,
        year,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (enqueued) pokeDrainer();
}

/**
 * Run `fn` after the surrounding transaction (if any) commits. Several
 * emitters (e.g. worker-hours) emit from inside a transaction; enqueuing
 * before commit could scan data that never lands. When there is no active
 * transaction, `onAfterCommit` runs the callback immediately.
 */
function afterCommit(fn: () => void): void {
  onAfterCommit(fn);
}

// ---------------------------------------------------------------------------
// Hours buffering: many hours rows typically arrive in one import. Buffer per
// employer/month for a few seconds; a large batch becomes one employer-scoped
// run, a trickle becomes per-worker entries.
// ---------------------------------------------------------------------------

interface HoursBucket {
  workerIds: Set<string>;
  timer: NodeJS.Timeout;
}

const hoursBuckets = new Map<string, HoursBucket>();

function bufferHoursEvent(payload: HoursSavedPayload): void {
  const key = `${payload.employerId}|${payload.year}|${payload.month}`;
  let bucket = hoursBuckets.get(key);
  if (!bucket) {
    const timer = setTimeout(() => {
      void flushHoursBucket(key, payload.employerId, payload.month, payload.year);
    }, HOURS_DEBOUNCE_MS);
    timer.unref?.();
    bucket = { workerIds: new Set(), timer };
    hoursBuckets.set(key, bucket);
  }
  bucket.workerIds.add(payload.workerId);
}

async function flushHoursBucket(
  key: string,
  employerId: string,
  month: number,
  year: number,
): Promise<void> {
  const bucket = hoursBuckets.get(key);
  hoursBuckets.delete(key);
  if (!bucket || bucket.workerIds.size === 0) return;

  try {
    if (bucket.workerIds.size >= BULK_WORKER_THRESHOLD) {
      const result = await enqueueMonthScan(
        storage,
        month,
        year,
        { type: "employer", employerId },
        "auto_hours_bulk",
      );
      logger.info("Auto-enqueued employer-scoped WMB rescan after bulk hours change", {
        service: SERVICE_NAME,
        employerId,
        month,
        year,
        distinctWorkers: bucket.workerIds.size,
        queuedCount: result.queuedCount,
      });
      pokeDrainer();
    } else {
      for (const workerId of bucket.workerIds) {
        await enqueueWorkerMonths(workerId, [{ month, year }], "hours_saved");
      }
    }
  } catch (err) {
    logger.error("Failed to flush hours bucket for WMB auto-rescan", {
      service: SERVICE_NAME,
      employerId,
      month,
      year,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleHoursSaved(payload: HoursSavedPayload): Promise<void> {
  if (!componentActive()) return;
  afterCommit(() => bufferHoursEvent(payload));
}

async function handlePaymentSaved(payload: PaymentSavedPayload): Promise<void> {
  if (!componentActive()) return;
  if (payload.entityType !== "worker") return;
  const workerId = payload.entityId;
  const base = payload.dateReceived ? new Date(payload.dateReceived) : new Date();
  const ref: MonthRef = { month: base.getMonth() + 1, year: base.getFullYear() };
  afterCommit(() => {
    void enqueueWorkerMonths(workerId, dedupeMonths([ref, currentMonth()]), "payment_saved");
  });
}

async function handleElectionSaved(payload: TrustElectionSavedPayload): Promise<void> {
  if (!componentActive()) return;
  afterCommit(() => {
    void enqueueWorkerMonths(payload.workerId, [currentMonth()], "election_saved");
  });
}

async function handleMshSaved(payload: WorkerMshSavedPayload): Promise<void> {
  if (!componentActive()) return;
  afterCommit(() => {
    void enqueueWorkerMonths(payload.workerId, [currentMonth()], "msh_saved");
  });
}

async function handleExemptionSaved(payload: TrustExemptionSavedPayload): Promise<void> {
  if (!componentActive()) return;
  // Exemption storage already defers the emit to after commit.
  const months = dedupeMonths([monthFromYmd(payload.startYmd), currentMonth()]);
  void enqueueWorkerMonths(payload.workerId, months, "exemption_saved");
}

// ---------------------------------------------------------------------------
// Init / shutdown
// ---------------------------------------------------------------------------

export function initWmbAutoRescan(): void {
  if (handlerIds.length > 0) {
    logger.warn("WMB auto-rescan already initialized", { service: SERVICE_NAME });
    return;
  }

  handlerIds.push(
    eventBus.on({
      name: "wmb-auto-rescan-hours",
      description: "Re-scans worker benefits when worker hours change (debounced; bulk imports collapse to an employer-scoped run).",
      event: EventType.HOURS_SAVED,
      handler: handleHoursSaved,
    }),
    eventBus.on({
      name: "wmb-auto-rescan-payment",
      description: "Re-scans a worker's benefits when a payment on their ledger account is saved.",
      event: EventType.PAYMENT_SAVED,
      handler: handlePaymentSaved,
    }),
    eventBus.on({
      name: "wmb-auto-rescan-election",
      description: "Re-scans a worker's benefits when a trust election is created, updated, or deleted.",
      event: EventType.TRUST_ELECTION_SAVED,
      handler: handleElectionSaved,
    }),
    eventBus.on({
      name: "wmb-auto-rescan-msh",
      description: "Re-scans a worker's benefits when their monthly status history changes.",
      event: EventType.WORKER_MSH_SAVED,
      handler: handleMshSaved,
    }),
    eventBus.on({
      name: "wmb-auto-rescan-exemption",
      description: "Re-scans a worker's benefits when an eligibility exemption is created, updated, or deleted.",
      event: EventType.TRUST_EXEMPTION_SAVED,
      handler: handleExemptionSaved,
    }),
  );

  logger.info("WMB auto-rescan initialized", { service: SERVICE_NAME });
}

export function shutdownWmbAutoRescan(): void {
  for (const id of handlerIds) {
    eventBus.off(id);
  }
  handlerIds.length = 0;
  for (const bucket of hoursBuckets.values()) {
    clearTimeout(bucket.timer);
  }
  hoursBuckets.clear();
}
