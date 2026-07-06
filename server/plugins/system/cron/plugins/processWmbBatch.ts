import { z } from "zod";
import type { JsonSchema } from "@shared/json-schema-form";
import { storage } from "../../../../storage";
import { processBatchQueueJobs } from "../../../../services/wmb-scan-queue";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

const settingsSchema = z.object({
  batchSize: z.number().int().min(1).max(100).default(10),
});

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    batchSize: {
      type: "integer",
      title: "Batch Size",
      description: "Number of jobs to process per cron run",
      minimum: 1,
      maximum: 100,
      default: 10,
    },
  },
};

type ProcessWmbBatchSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: ProcessWmbBatchSettings = {
  batchSize: 10,
};

registerCronPlugin({
  metadata: {
    id: 'process-wmb-batch',
    name: 'Process WMB Batch',
    description: 'Processes pending WMB scan jobs from the queue in batches',
    requiredComponent: 'trust.benefits.scan',
    singleton: true,
  },
  defaultSchedule: '*/5 * * * *', // Every 5 minutes
  defaultEnabled: false,

  settingsSchema,
  configSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

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
});
