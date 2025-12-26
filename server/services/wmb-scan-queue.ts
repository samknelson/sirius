import type { IStorage } from "../storage";
import { DatabaseStorage } from "../storage/database";
import { runBenefitsScan, type BenefitsScanResult } from "./benefits-scan";
import { logger } from "../logger";
import { sendStaffAlerts } from "./alert-dispatcher";
import type { StaffAlertMessagePayload } from "@shared/staffAlertMessages";
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
      setImmediate(() => sendScanCompletionAlerts(jobResultInfo.completedStatus!));
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
      setImmediate(() => sendScanCompletionAlerts(jobResultInfo.completedStatus!));
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

async function sendScanCompletionAlerts(
  completedStatus: TrustWmbScanStatus
): Promise<void> {
  const storage = new DatabaseStorage();
  try {
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[completedStatus.month - 1] || `Month ${completedStatus.month}`;
    const periodLabel = `${monthName} ${completedStatus.year}`;

    const totalProcessed = (completedStatus.processedSuccess || 0) + (completedStatus.processedFailed || 0);
    const successCount = completedStatus.processedSuccess || 0;
    const failedCount = completedStatus.processedFailed || 0;
    const benefitsStarted = completedStatus.benefitsStarted || 0;
    const benefitsContinued = completedStatus.benefitsContinued || 0;
    const benefitsTerminated = completedStatus.benefitsTerminated || 0;

    const payload: StaffAlertMessagePayload = {
      sms: {
        text: `WMB Scan for ${periodLabel} completed. ${totalProcessed} workers processed (${successCount} success, ${failedCount} failed). Benefits: ${benefitsStarted} started, ${benefitsContinued} continued, ${benefitsTerminated} terminated.`,
      },
      email: {
        subject: `WMB Scan Completed: ${periodLabel}`,
        bodyText: `The Worker Monthly Benefits scan for ${periodLabel} has completed.\n\nSummary:\n- Total workers processed: ${totalProcessed}\n- Successful: ${successCount}\n- Failed: ${failedCount}\n\nBenefit Changes:\n- Benefits Started: ${benefitsStarted}\n- Benefits Continued: ${benefitsContinued}\n- Benefits Terminated: ${benefitsTerminated}\n\nYou can view the full report in the WMB Scan Queue page.`,
        bodyHtml: `
          <h2>WMB Scan Completed: ${periodLabel}</h2>
          <p>The Worker Monthly Benefits scan for ${periodLabel} has completed.</p>
          <h3>Summary</h3>
          <ul>
            <li><strong>Total workers processed:</strong> ${totalProcessed}</li>
            <li><strong>Successful:</strong> ${successCount}</li>
            <li><strong>Failed:</strong> ${failedCount}</li>
          </ul>
          <h3>Benefit Changes</h3>
          <ul>
            <li><strong>Benefits Started:</strong> ${benefitsStarted}</li>
            <li><strong>Benefits Continued:</strong> ${benefitsContinued}</li>
            <li><strong>Benefits Terminated:</strong> ${benefitsTerminated}</li>
          </ul>
          <p>You can view the full report in the WMB Scan Queue page.</p>
        `,
      },
      inapp: {
        title: `WMB Scan Completed: ${periodLabel}`,
        body: `Processed ${totalProcessed} workers (${successCount} success, ${failedCount} failed). Benefits: ${benefitsStarted} started, ${benefitsContinued} continued, ${benefitsTerminated} terminated.`,
        linkUrl: `/admin/wmb-scan/${completedStatus.id}`,
        linkLabel: "View Scan Details",
      },
    };

    const result = await sendStaffAlerts("trust_wmb_scan", payload, storage);

    if (result.deliveryResults.some(r => r.status === 'failed')) {
      const failures = result.deliveryResults.filter(r => r.status === 'failed');
      logger.warn(`Some scan completion alerts failed`, {
        service: "wmb-scan-queue",
        month: completedStatus.month,
        year: completedStatus.year,
        failures: failures.map(f => ({
          userId: f.userId,
          medium: f.medium,
          error: f.error,
          errorCode: f.errorCode,
        })),
      });
    }

    logger.info(`Sent scan completion alerts for ${periodLabel}`, {
      service: "wmb-scan-queue",
      month: completedStatus.month,
      year: completedStatus.year,
      totalRecipients: result.totalRecipients,
      summary: result.summary,
    });
  } catch (error: any) {
    logger.error("Failed to send scan completion alerts", {
      service: "wmb-scan-queue",
      month: completedStatus.month,
      year: completedStatus.year,
      error: error.message,
    });
  }
}
