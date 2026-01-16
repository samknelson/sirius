import { z } from "zod";
import { storage } from "../../storage";
import { processBatchQueueJobs, type ProcessingResult } from "../../services/wmb-scan-queue";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary, CronJobSettingsField } from "../registry";

const settingsSchema = z.object({
  batchSize: z.number().int().min(1).max(100).default(10),
});

type ProcessWmbBatchSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: ProcessWmbBatchSettings = {
  batchSize: 10,
};

export const processWmbBatchHandler: CronJobHandler = {
  description: 'Processes pending WMB scan jobs from the queue in batches',
  requiresComponent: 'trust.benefits.scan',

  settingsSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  getSettingsFields: (): CronJobSettingsField[] => [
    {
      key: 'batchSize',
      label: 'Batch Size',
      type: 'number',
      description: 'Number of jobs to process per cron run',
      min: 1,
      max: 100,
    },
  ],

  async execute(context: CronJobContext): Promise<CronJobSummary> {
    const settings = settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...context.settings,
    });

    logger.info('Starting WMB batch processing', {
      service: 'cron-process-wmb-batch',
      jobId: context.jobId,
      batchSize: settings.batchSize,
      mode: context.mode,
    });

    try {
      let result: ProcessingResult;

      const getQueueStats = async () => {
        const summary = await storage.wmbScanQueue.getPendingSummary();
        const totals = summary.reduce(
          (acc, row) => ({
            pending: acc.pending + row.pending,
            processing: acc.processing + row.processing,
            success: acc.success + row.success,
            failed: acc.failed + row.failed,
          }),
          { pending: 0, processing: 0, success: 0, failed: 0 }
        );
        return totals;
      };

      if (context.mode === 'test') {
        const stats = await getQueueStats();
        const wouldProcess = Math.min(stats.pending + stats.processing, settings.batchSize);
        
        logger.info('[TEST MODE] WMB batch processing - would process', {
          service: 'cron-process-wmb-batch',
          jobId: context.jobId,
          wouldProcess,
          batchSize: settings.batchSize,
        });

        return {
          mode: 'test',
          batchSize: settings.batchSize,
          wouldProcess,
          queueStatus: {
            queuedCount: stats.pending,
            processingCount: stats.processing,
            completedCount: stats.success,
            failedCount: stats.failed,
          },
        };
      }

      result = await processBatchQueueJobs(storage, settings.batchSize);

      const stats = await getQueueStats();

      logger.info('WMB batch processing completed', {
        service: 'cron-process-wmb-batch',
        jobId: context.jobId,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
      });

      return {
        mode: 'live',
        batchSize: settings.batchSize,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        queueStatus: {
          queuedCount: stats.pending,
          processingCount: stats.processing,
          completedCount: stats.success,
          failedCount: stats.failed,
        },
      };

    } catch (error) {
      logger.error('Failed to process WMB batch', {
        service: 'cron-process-wmb-batch',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
