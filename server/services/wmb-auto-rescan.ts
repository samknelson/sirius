import {
  eventBus,
  EventType,
  type HoursSavedPayload,
  type PaymentSavedPayload,
  type TrustElectionSavedPayload,
  type TrustExemptionSavedPayload,
  type WorkerMshSavedPayload,
  type WorkerWshSavedPayload,
  type WmbSavedPayload,
} from "./event-bus";
import { onAfterCommit } from "../storage/transaction-context";
import { isWmbScanWrite } from "../middleware/request-context";
import { storage } from "../storage";
import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";
import { eligibilityPluginRegistry } from "../plugins/trust/eligibility/registry";
import type { BaseEligibilityConfig } from "../plugins/trust/eligibility/types";
import {
  enqueueMonthScan,
  processNextQueueJob,
  PER_WORKER_AUTO_TRIGGER_SOURCES,
} from "./wmb-scan-queue";

const SERVICE_NAME = "wmb-auto-rescan";
const COMPONENT_ID = "trust.benefits";

/** Trigger sources owned by this service; the drainer only claims these. */
export const AUTO_TRIGGER_SOURCES = [...PER_WORKER_AUTO_TRIGGER_SOURCES, "auto_hours_bulk"];

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

function monthToYmd(ref: MonthRef): string {
  return `${ref.year}-${String(ref.month).padStart(2, "0")}-01`;
}

function addMonths(ref: MonthRef, n: number): MonthRef {
  const total = ref.year * 12 + (ref.month - 1) + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/** Cap on how many months a single event may enqueue for one worker. */
const MAX_SPAN_MONTHS = 12;

/**
 * All months from `startYmd` through `endYmd` (or the current month when the
 * range is open-ended or ends in the future). If the span exceeds the cap,
 * the MOST RECENT months are kept, since recent periods matter most.
 */
function monthsInRange(startYmd: string, endYmd: string | null): MonthRef[] {
  const start = monthFromYmd(startYmd);
  if (!start) return [currentMonth()];
  const now = currentMonth();
  let end = endYmd ? monthFromYmd(endYmd) ?? now : now;
  // Clamp end to the current month; future periods have no data to scan yet.
  if (end.year > now.year || (end.year === now.year && end.month > now.month)) {
    end = now;
  }
  // Guard against inverted ranges.
  if (start.year > end.year || (start.year === end.year && start.month > end.month)) {
    return [end];
  }
  const out: MonthRef[] = [];
  let { month, year } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    out.push({ month, year });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out.length > MAX_SPAN_MONTHS ? out.slice(out.length - MAX_SPAN_MONTHS) : out;
}

function isFutureMonth(ref: MonthRef, now: MonthRef): boolean {
  return ref.year > now.year || (ref.year === now.year && ref.month > now.month);
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

export async function enqueueWorkerMonths(
  workerId: string,
  months: MonthRef[],
  reason: string,
  triggerSource: string = "worker_update",
): Promise<void> {
  let enqueued = false;
  for (const { month, year } of months) {
    try {
      // Skip if this worker/month is already waiting to be scanned.
      const existing = await storage.wmbScanQueue.getWorkerQueueEntry(workerId, month, year);
      if (existing && (existing.status === "pending" || existing.status === "processing")) {
        continue;
      }
      await storage.wmbScanQueue.enqueueWorker(workerId, month, year, triggerSource);
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
// Hours-impact horizon: several eligibility rules read EARLIER months' hours
// (GBHET Legal checks the month `monthsOffset` prior, BAO Threshold the month
// 3 prior, BAO Buildup walks back from `lagMonths` prior), so a change to
// month M's hours can flip eligibility for months after M. Each hours-reading
// plugin reports its own forward impact from its config
// (EligibilityPlugin.hoursForwardImpactMonths); the horizon is the maximum
// across the configured trust-eligibility rules whose plugin's required
// component is enabled (matching the executor, the rules' `enabled` flag is
// not consulted). Capped at MAX_SPAN_MONTHS - 1 so the inclusive span
// (hours month + horizon later months) never exceeds MAX_SPAN_MONTHS —
// otherwise the cap in monthsInRange would drop the edited hours month
// itself. Cached briefly, falling back to the capped conservative maximum
// when resolution fails.
// ---------------------------------------------------------------------------

const HORIZON_CACHE_MS = 60_000;
let horizonCache: { value: number; at: number } | null = null;

/** Test hook: clear the cached horizon so the next call re-resolves. */
export function resetHoursHorizonCache(): void {
  horizonCache = null;
}

export async function resolveHoursImpactHorizon(): Promise<number> {
  const nowMs = Date.now();
  if (horizonCache && nowMs - horizonCache.at < HORIZON_CACHE_MS) {
    return horizonCache.value;
  }
  try {
    const rows = await storage.pluginConfigs.search("trust-eligibility", {});
    let horizon = 0;
    for (const row of rows) {
      const plugin = eligibilityPluginRegistry.get(row.config.pluginId);
      if (!plugin) continue;
      const required = plugin.metadata.requiredComponent;
      if (required && !isComponentEnabledSync(required)) continue;
      const data = (row.config.data ?? {}) as BaseEligibilityConfig;
      const impact = plugin.hoursForwardImpactMonths(data);
      if (Number.isFinite(impact) && impact > horizon) horizon = impact;
    }
    horizon = Math.min(horizon, MAX_SPAN_MONTHS - 1);
    horizonCache = { value: horizon, at: nowMs };
    return horizon;
  } catch (err) {
    logger.error(
      "Failed to resolve hours-impact horizon; using conservative maximum",
      {
        service: SERVICE_NAME,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    // Not cached: retry resolution on the next flush.
    return MAX_SPAN_MONTHS - 1;
  }
}

/**
 * The months a change to `hoursMonth`'s hours can affect: the month itself
 * plus every later month within the resolved horizon, clamped to the current
 * month (future months have no data yet) and capped at MAX_SPAN_MONTHS
 * keeping the most recent. A future hours month keeps the pre-existing
 * behavior of scanning just that month.
 */
export async function affectedMonthsForHours(hoursMonth: MonthRef): Promise<MonthRef[]> {
  if (isFutureMonth(hoursMonth, currentMonth())) {
    return [hoursMonth];
  }
  const horizon = await resolveHoursImpactHorizon();
  return monthsInRange(
    monthToYmd(hoursMonth),
    monthToYmd(addMonths(hoursMonth, horizon)),
  );
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
    // The hours month itself plus the later months whose eligibility rules
    // read it (e.g. correcting April's hours changes July's eligibility).
    const months = await affectedMonthsForHours({ month, year });

    if (bucket.workerIds.size >= BULK_WORKER_THRESHOLD) {
      for (const ref of months) {
        const result = await enqueueMonthScan(
          storage,
          ref.month,
          ref.year,
          { type: "employer", employerId },
          "auto_hours_bulk",
        );
        logger.info("Auto-enqueued employer-scoped WMB rescan after bulk hours change", {
          service: SERVICE_NAME,
          employerId,
          month: ref.month,
          year: ref.year,
          hoursMonth: month,
          hoursYear: year,
          distinctWorkers: bucket.workerIds.size,
          queuedCount: result.queuedCount,
        });
      }
      pokeDrainer();
    } else {
      for (const workerId of bucket.workerIds) {
        await enqueueWorkerMonths(workerId, months, "hours_saved");
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
  // Storage emits both the new and (when dates changed) old ranges, so
  // covering this payload's span covers every affected period.
  const months = dedupeMonths([
    ...monthsInRange(payload.startYmd, payload.endYmd),
    currentMonth(),
  ]);
  afterCommit(() => {
    void enqueueWorkerMonths(payload.workerId, months, "election_saved");
  });
}

async function handleMshSaved(payload: WorkerMshSavedPayload): Promise<void> {
  if (!componentActive()) return;
  // A member-status change is effective from its date onward; the payload's
  // effectiveYmd is the earliest date touched (old + new for date moves).
  const months = payload.effectiveYmd
    ? dedupeMonths([...monthsInRange(payload.effectiveYmd, null), currentMonth()])
    : [currentMonth()];
  afterCommit(() => {
    void enqueueWorkerMonths(payload.workerId, months, "msh_saved");
  });
}

async function handleWshSaved(payload: WorkerWshSavedPayload): Promise<void> {
  if (!componentActive()) return;
  // A work-status change applies from its date onward; the payload's
  // effectiveYmd is the earliest date touched (old + new for date moves),
  // mirroring the member-status pattern.
  const months = payload.effectiveYmd
    ? dedupeMonths([...monthsInRange(payload.effectiveYmd, null), currentMonth()])
    : [currentMonth()];
  afterCommit(() => {
    void enqueueWorkerMonths(payload.workerId, months, "work_status_saved", "work_status_saved");
  });
}

async function handleWmbSaved(payload: WmbSavedPayload): Promise<void> {
  if (!componentActive()) return;
  // Loop guard: WMB rows written by the benefits scan itself are flagged via
  // the ambient request context (see withWmbScanWrites in benefits-scan);
  // reacting to them would feed the queue from its own output.
  if (isWmbScanWrite()) return;
  const now = currentMonth();
  const sameMonth: MonthRef = { month: payload.month, year: payload.year };
  // Future months are skipped entirely — they have no data yet and are
  // covered by their own monthly scan when the time comes.
  if (isFutureMonth(sameMonth, now)) return;
  // Rescan the edited month itself (Linked rules re-evaluate) and every
  // month through the current one (the Prior Month chain re-evaluates).
  // The full span is needed because the loop guard means scan-written rows
  // never cascade enqueues on their own.
  const startYmd = `${sameMonth.year}-${String(sameMonth.month).padStart(2, "0")}-01`;
  const months = monthsInRange(startYmd, null);
  afterCommit(() => {
    void enqueueWorkerMonths(payload.workerId, months, "wmb_saved", "wmb_saved");
  });
}

async function handleExemptionSaved(payload: TrustExemptionSavedPayload): Promise<void> {
  if (!componentActive()) return;
  // Exemption storage already defers the emit to after commit. Storage emits
  // both old and new ranges when dates change, so span this payload's range.
  const months = dedupeMonths([
    ...monthsInRange(payload.startYmd, payload.endYmd),
    currentMonth(),
  ]);
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
      description: "Re-scans worker benefits when worker hours change — the hours month plus the later months whose eligibility rules read it (debounced; bulk imports collapse to employer-scoped runs).",
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
    eventBus.on({
      name: "wmb-auto-rescan-wsh",
      description: "Re-scans a worker's benefits when their work-status history changes (effective date through the current month).",
      event: EventType.WORKER_WSH_SAVED,
      handler: handleWshSaved,
    }),
    eventBus.on({
      name: "wmb-auto-rescan-wmb",
      description: "Re-scans the edited month through the current month when a benefit row is manually added or deleted; rows written by the benefits scan itself are ignored (loop guard).",
      event: EventType.WMB_SAVED,
      handler: handleWmbSaved,
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
