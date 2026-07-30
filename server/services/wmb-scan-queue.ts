import type { IStorage } from "../storage";
import type { ScanScope } from "../storage/wmb-scan-queue";
import { runBenefitsScan, type BenefitsScanResult } from "./benefits-scan";
import {
  createPolicyResolutionCache,
  type PolicyResolutionCache,
} from "./policy-resolution";
import { logger } from "../logger";
import { eventBus, EventType } from "./event-bus";
import type { TrustWmbScanStatus, TrustWmbScanQueue } from "@shared/schema";
import { checkFlood, recordFloodEvent } from "../flood/service";
import { floodEventRegistry } from "../flood/registry";
import {
  WMB_IMMEDIATE_SCAN_FLOOD_EVENT,
  WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT,
} from "../flood/events";

/**
 * Per-worker, event-driven trigger sources. Jobs from these sources also
 * re-evaluate the worker's covered dependents (e.g. a DP payment must re-gate
 * the DP dependent's benefit, which is keyed to the dependent's own worker
 * id). Batch runs (monthly_batch / auto_hours_bulk) keep dependents off
 * because they already enqueue each worker in the population as its own job.
 */
export const PER_WORKER_AUTO_TRIGGER_SOURCES = [
  "worker_update",
  "work_status_saved",
  "wmb_saved",
  "cardcheck_saved",
  "cobra_case_saved",
  "ledger_entry_saved",
  "employment_saved",
];

export interface QueueProcessorOptions {
  maxConcurrent?: number;
  batchSize?: number;
  maxRetries?: number;
}

export interface ProcessingResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function processNextQueueJob(
  storage: IStorage,
  triggerSources?: string[],
  policyCache?: PolicyResolutionCache
): Promise<{ processed: boolean; workerId?: string; success?: boolean }> {
  const job = await storage.wmbScanQueue.claimNextJob(triggerSources);
  if (!job) {
    return { processed: false };
  }
  return processClaimedJob(storage, job, policyCache);
}

/**
 * Run one ALREADY-CLAIMED job through the scan and record its result. Shared
 * by the cron path (`processNextQueueJob`, which claims via `claimNextJob`)
 * and the immediate fast path (`tryImmediateScan`, which claims via
 * `claimJobById`), so success/failure recording, retries/failure counts and
 * event emission behave identically regardless of which path ran the job.
 */
export async function processClaimedJob(
  storage: IStorage,
  job: TrustWmbScanQueue,
  policyCache?: PolicyResolutionCache
): Promise<{ processed: boolean; workerId?: string; success?: boolean }> {
  logger.info(`Processing WMB scan job for worker ${job.workerId}`, {
    service: "wmb-scan-queue",
    jobId: job.id,
    workerId: job.workerId,
    month: job.month,
    year: job.year,
    attempt: job.attempts,
  });

  try {
    // Event-driven single-worker jobs also re-evaluate the worker's covered
    // dependents; see PER_WORKER_AUTO_TRIGGER_SOURCES.
    const includeDependents = PER_WORKER_AUTO_TRIGGER_SOURCES.includes(job.triggerSource);
    const result = await runBenefitsScan(
      storage,
      job.workerId,
      job.month,
      job.year,
      "live",
      { includeDependents, policyCache }
    );

    const jobResultInfo = await storage.wmbScanQueue.recordJobResult(
      job.id,
      true,
      {
        policyId: result.policyId,
        policyName: result.policyName,
        employerId: result.employerId,
        summary: result.summary,
        actions: result.actions.map(a => ({
          benefitId: a.benefitId,
          benefitName: a.benefitName,
          scanType: a.scanType,
          eligible: a.eligible,
          action: a.action,
          executed: a.executed,
          pluginResults: a.pluginResults,
        })),
      }
    );

    logger.info(`Completed WMB scan job for worker ${job.workerId}`, {
      service: "wmb-scan-queue",
      jobId: job.id,
      summary: result.summary,
    });

    // Per-worker scan-result event (the aggregate TRUST_WMB_SCAN_COMPLETED
    // fires separately when the whole month finishes). Listeners such as the
    // trust-wmb-terminate denorm plugin react to this. Emit failures are
    // logged but never fail the job.
    try {
      await eventBus.emit(EventType.TRUST_WMB_SCAN_WORKER_COMPLETED, {
        queueId: job.id,
        workerId: job.workerId,
        month: job.month,
        year: job.year,
        actions: result.actions.map(a => ({
          benefitId: a.benefitId,
          benefitName: a.benefitName,
          scanType: a.scanType,
          eligible: a.eligible,
          action: a.action,
          executed: a.executed,
          pluginResults: a.pluginResults,
        })),
      });
    } catch (emitError: any) {
      logger.error("Failed to emit per-worker WMB scan completion event", {
        service: "wmb-scan-queue",
        jobId: job.id,
        workerId: job.workerId,
        error: emitError?.message ?? String(emitError),
      });
    }

    if (jobResultInfo.scanCompleted && jobResultInfo.completedStatus) {
      setImmediate(() => emitScanCompletedEvent(jobResultInfo.completedStatus!));
    }

    return { processed: true, workerId: job.workerId, success: true };
  } catch (error: any) {
    logger.error(`Failed WMB scan job for worker ${job.workerId}`, {
      service: "wmb-scan-queue",
      jobId: job.id,
      error: error.message,
    });

    const jobResultInfo = await storage.wmbScanQueue.recordJobResult(
      job.id,
      false,
      null,
      error.message
    );

    if (jobResultInfo.scanCompleted && jobResultInfo.completedStatus) {
      setImmediate(() => emitScanCompletedEvent(jobResultInfo.completedStatus!));
    }

    return { processed: true, workerId: job.workerId, success: false };
  }
}

export interface ImmediateScanOutcome {
  ran: boolean;
  /** Why the fast path was skipped (when ran=false). */
  deferredReason?: "disabled" | "worker-cap" | "global-cap" | "flood-error";
  claimedJobs?: number;
}

/**
 * Immediate WMB scan fast path. Called (fire-and-forget) right after
 * per-worker jobs from an event-driven trigger source are enqueued and
 * committed. Checks the per-worker and global flood caps; when within
 * budget it records both flood events, atomically claims each just-enqueued
 * job (so the cron can never double-process it) and runs it through the
 * exact same job-processing logic as the cron. When over budget, disabled
 * (global cap 0), or on ANY flood-check error, it quietly defers: the jobs
 * stay pending and the existing cron processes them as today.
 *
 * `deps.processJob` is a test seam; production always uses
 * `processClaimedJob`.
 */
export async function tryImmediateScan(
  storage: IStorage,
  workerId: string,
  queueIds: string[],
  deps: { processJob?: typeof processClaimedJob } = {}
): Promise<ImmediateScanOutcome> {
  const processJob = deps.processJob ?? processClaimedJob;
  const logCtx = { service: "wmb-immediate-scan", workerId, queueIds };

  // Flood gate — fail OPEN toward the cron path: any error means "defer".
  try {
    const globalDef = floodEventRegistry.get(WMB_IMMEDIATE_SCAN_FLOOD_EVENT);
    if (!globalDef || globalDef.threshold <= 0) {
      logger.info("Immediate WMB scan disabled (cap 0); deferring to cron", logCtx);
      return { ran: false, deferredReason: "disabled" };
    }

    const workerCheck = await checkFlood(WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT, { workerId });
    if (!workerCheck.allowed) {
      logger.info("Immediate WMB scan deferred to cron: worker scanned within the last minute", {
        ...logCtx,
        count: workerCheck.count,
        threshold: workerCheck.threshold,
      });
      return { ran: false, deferredReason: "worker-cap" };
    }

    const globalCheck = await checkFlood(WMB_IMMEDIATE_SCAN_FLOOD_EVENT, {});
    if (!globalCheck.allowed) {
      logger.info("Immediate WMB scan deferred to cron: per-minute budget exhausted", {
        ...logCtx,
        count: globalCheck.count,
        threshold: globalCheck.threshold,
      });
      return { ran: false, deferredReason: "global-cap" };
    }

    await recordFloodEvent(WMB_IMMEDIATE_SCAN_WORKER_FLOOD_EVENT, { workerId });
    await recordFloodEvent(WMB_IMMEDIATE_SCAN_FLOOD_EVENT, {});
  } catch (err) {
    logger.warn("Immediate WMB scan flood check failed; deferring to cron", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: false, deferredReason: "flood-error" };
  }

  let claimedJobs = 0;
  for (const queueId of queueIds) {
    try {
      const job = await storage.wmbScanQueue.claimJobById(queueId);
      // Already claimed elsewhere (e.g. the cron got there first) — skip.
      if (!job) continue;
      claimedJobs++;
      // processClaimedJob records success/failure on the job itself exactly
      // like the cron path, so a scan failure here never throws upward.
      await processJob(storage, job);
    } catch (err) {
      logger.error("Immediate WMB scan job processing failed", {
        ...logCtx,
        queueId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(`Immediate WMB scan ran for worker ${workerId}`, {
    ...logCtx,
    claimedJobs,
    requestedJobs: queueIds.length,
  });
  return { ran: true, claimedJobs };
}

export async function processBatchQueueJobs(
  storage: IStorage,
  batchSize: number = 10
): Promise<ProcessingResult> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  // One policy-resolution cache per batch run: workers at the same employer
  // share the employer's policy-history fetch instead of re-querying per job.
  const policyCache = createPolicyResolutionCache();

  for (let i = 0; i < batchSize; i++) {
    const result = await processNextQueueJob(storage, undefined, policyCache);
    if (!result.processed) {
      break;
    }
    processed++;
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { processed, succeeded, failed };
}

export async function enqueueMonthScan(
  storage: IStorage,
  month: number,
  year: number,
  scope: ScanScope = { type: "all" },
  triggerSource: string = "monthly_batch"
): Promise<{ statusId: string; queuedCount: number }> {
  logger.info(`Enqueuing WMB scan for month ${month}/${year}`, {
    service: "wmb-scan-queue",
    month,
    year,
    scopeType: scope.type,
    scopeEmployerId: scope.type === "employer" ? scope.employerId : null,
    triggerSource,
  });

  const result = await storage.wmbScanQueue.enqueueMonth(month, year, scope, triggerSource);

  logger.info(`Enqueued ${result.queuedCount} workers for WMB scan`, {
    service: "wmb-scan-queue",
    statusId: result.statusId,
    queuedCount: result.queuedCount,
  });

  return result;
}

export async function invalidateWorkerScans(
  storage: IStorage,
  workerId: string
): Promise<number> {
  const count = await storage.wmbScanQueue.invalidateWorkerScans(workerId);
  
  if (count > 0) {
    logger.info(`Invalidated ${count} WMB scan entries for worker ${workerId}`, {
      service: "wmb-scan-queue",
      workerId,
      invalidatedCount: count,
    });
  }

  return count;
}

/**
 * Announce that a monthly WMB scan finished by emitting
 * `TRUST_WMB_SCAN_COMPLETED` on the event bus. The event-notifier framework
 * (the `trust-wmb-scan` notifier) owns recipient resolution, media selection
 * and the actual sends; this service is only responsible for firing the event.
 */
async function emitScanCompletedEvent(
  completedStatus: TrustWmbScanStatus
): Promise<void> {
  try {
    const successCount = completedStatus.processedSuccess || 0;
    const failedCount = completedStatus.processedFailed || 0;
    await eventBus.emit(EventType.TRUST_WMB_SCAN_COMPLETED, {
      statusId: completedStatus.id,
      month: completedStatus.month,
      year: completedStatus.year,
      totalProcessed: successCount + failedCount,
      successCount,
      failedCount,
      benefitsStarted: completedStatus.benefitsStarted || 0,
      benefitsContinued: completedStatus.benefitsContinued || 0,
      benefitsTerminated: completedStatus.benefitsTerminated || 0,
    });
  } catch (error: any) {
    logger.error("Failed to emit WMB scan completion event", {
      service: "wmb-scan-queue",
      month: completedStatus.month,
      year: completedStatus.year,
      error: error?.message ?? String(error),
    });
  }
}
