import type { IStorage } from "../storage";
import { runBenefitsScan, type BenefitsScanResult } from "./benefits-scan";
import { logger } from "../logger";
import { eventBus, EventType } from "./event-bus";
import type { TrustWmbScanStatus } from "@shared/schema";

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
  storage: IStorage
): Promise<{ processed: boolean; workerId?: string; success?: boolean }> {
  const job = await storage.wmbScanQueue.claimNextJob();
  if (!job) {
    return { processed: false };
  }

  logger.info(`Processing WMB scan job for worker ${job.workerId}`, {
    service: "wmb-scan-queue",
    jobId: job.id,
    workerId: job.workerId,
    month: job.month,
    year: job.year,
    attempt: job.attempts,
  });

  try {
    const result = await runBenefitsScan(
      storage,
      job.workerId,
      job.month,
      job.year,
      "live"
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

export async function processBatchQueueJobs(
  storage: IStorage,
  batchSize: number = 10
): Promise<ProcessingResult> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < batchSize; i++) {
    const result = await processNextQueueJob(storage);
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
  year: number
): Promise<{ statusId: string; queuedCount: number }> {
  logger.info(`Enqueuing WMB scan for month ${month}/${year}`, {
    service: "wmb-scan-queue",
    month,
    year,
  });

  const result = await storage.wmbScanQueue.enqueueMonth(month, year);

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
