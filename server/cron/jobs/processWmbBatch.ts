import { z } from "zod";
import { storage } from "../../storage";
import { processBatchQueueJobs } from "../../services/wmb-scan-queue";
import type { CronJobHandler, CronJobContext, CronJobResult, CronJobSettingsField } from "../registry";

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

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const settings = settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...context.settings,
    });

    const getQueueStats = async () => {
      const summary = await storage.wmbScanQueue.getPendingSummary();
      return summary.reduce(
        (acc, row) => ({
          pending: acc.pending + row.pending,
          processing: acc.processing + row.processing,
          success: acc.success + row.success,
          failed: acc.failed + row.failed,
        }),
        { pending: 0, processing: 0, success: 0, failed: 0 }
      );
    };

    if (context.mode === 'test') {
      const stats = await getQueueStats();
      const wouldProcess = Math.min(stats.pending + stats.processing, settings.batchSize);

      return {
        message: `Would process ${wouldProcess} WMB scan jobs (${stats.pending} pending, batch size ${settings.batchSize})`,
        metadata: {
          wouldProcess,
          batchSize: settings.batchSize,
          queueStatus: stats,
        },
      };
    }

    const result = await processBatchQueueJobs(storage, settings.batchSize);
    const stats = await getQueueStats();

    return {
      message: `Processed ${result.processed} jobs: ${result.succeeded} succeeded, ${result.failed} failed`,
      metadata: {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        batchSize: settings.batchSize,
        queueStatus: stats,
      },
    };
  },
};
