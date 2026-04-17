import { z } from "zod";
import { storage } from "../../storage";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { deliverToParticipant } from "../../modules/bulk/deliver";
import type { CronJobHandler, CronJobContext, CronJobResult, CronJobSettingsField } from "../registry";

const settingsSchema = z.object({
  emailBatchSize: z.number().int().min(1).max(500).default(25),
  smsBatchSize: z.number().int().min(1).max(500).default(25),
  postalBatchSize: z.number().int().min(1).max(500).default(25),
  inappBatchSize: z.number().int().min(1).max(500).default(50),
});

type BulkDeliverSettings = z.infer<typeof settingsSchema>;

const DEFAULT_SETTINGS: BulkDeliverSettings = {
  emailBatchSize: 25,
  smsBatchSize: 25,
  postalBatchSize: 25,
  inappBatchSize: 50,
};

const MEDIUM_BATCH_KEY: Record<string, keyof BulkDeliverSettings> = {
  email: "emailBatchSize",
  sms: "smsBatchSize",
  postal: "postalBatchSize",
  inapp: "inappBatchSize",
};

const rawParticipantStorage = createBulkParticipantStorage();

function getBatchSizeForMedium(settings: BulkDeliverSettings, medium: string): number {
  const batchKey = MEDIUM_BATCH_KEY[medium];
  return batchKey ? settings[batchKey] : 25;
}

export const bulkDeliverHandler: CronJobHandler = {
  description: 'Delivers queued bulk messages to pending participants in batches',
  requiresComponent: 'bulk',

  settingsSchema,

  getDefaultSettings: () => DEFAULT_SETTINGS,

  getSettingsFields: (): CronJobSettingsField[] => [
    {
      key: 'emailBatchSize',
      label: 'Email Batch Size',
      type: 'number',
      description: 'Number of email participants to deliver per run',
      min: 1,
      max: 500,
    },
    {
      key: 'smsBatchSize',
      label: 'SMS Batch Size',
      type: 'number',
      description: 'Number of SMS participants to deliver per run',
      min: 1,
      max: 500,
    },
    {
      key: 'postalBatchSize',
      label: 'Postal Batch Size',
      type: 'number',
      description: 'Number of postal participants to deliver per run',
      min: 1,
      max: 500,
    },
    {
      key: 'inappBatchSize',
      label: 'In-App Batch Size',
      type: 'number',
      description: 'Number of in-app participants to deliver per run',
      min: 1,
      max: 500,
    },
  ],

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const settings = settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...context.settings,
    });

    const queuedMessages = await storage.bulkMessages.getAll({ status: "queued" });

    const now = new Date();
    const eligibleMessages = queuedMessages.filter((msg) => {
      if (!msg.sendDate) return true;
      return new Date(msg.sendDate) <= now;
    });

    if (context.mode === 'test') {
      let totalPending = 0;
      const messageSummaries: Array<{ id: string; name: string; media: string[]; pendingCount: number }> = [];

      for (const msg of eligibleMessages) {
        const totalBatch = msg.medium.reduce((sum, m) => sum + getBatchSizeForMedium(settings, m), 0);
        const pending = await rawParticipantStorage.getPendingByMessageId(msg.id, totalBatch);
        totalPending += pending.length;
        messageSummaries.push({
          id: msg.id,
          name: msg.name,
          media: msg.medium,
          pendingCount: pending.length,
        });
      }

      return {
        message: `Would process ${totalPending} participants across ${eligibleMessages.length} queued messages (${queuedMessages.length - eligibleMessages.length} skipped for future send date)`,
        metadata: {
          queuedMessages: queuedMessages.length,
          eligibleMessages: eligibleMessages.length,
          skippedFuture: queuedMessages.length - eligibleMessages.length,
          totalPending,
          messages: messageSummaries,
        },
      };
    }

    let totalSeeComm = 0;
    let totalSendFailed = 0;
    let totalProcessed = 0;

    for (const msg of eligibleMessages) {
      const mediumCounts: Record<string, number> = {};

      const totalBatch = msg.medium.reduce((sum, m) => sum + getBatchSizeForMedium(settings, m), 0);
      const pendingParticipants = await rawParticipantStorage.getPendingByMessageId(msg.id, totalBatch);

      for (const participant of pendingParticipants) {
        const participantMedium = participant.medium;
        const batchSize = getBatchSizeForMedium(settings, participantMedium);
        const currentCount = mediumCounts[participantMedium] || 0;
        if (currentCount >= batchSize) continue;
        mediumCounts[participantMedium] = currentCount + 1;

        try {
          const result = await deliverToParticipant(storage, msg.id, participant.id);
          totalProcessed++;
          if (result.commId) {
            totalSeeComm++;
          } else {
            totalSendFailed++;
          }
        } catch {
          totalSendFailed++;
          totalProcessed++;
        }
      }
    }

    return {
      message: `Processed ${totalProcessed} participants across ${eligibleMessages.length} messages: ${totalSeeComm} see_comm, ${totalSendFailed} send_failed`,
      metadata: {
        queuedMessages: queuedMessages.length,
        eligibleMessages: eligibleMessages.length,
        skippedFuture: queuedMessages.length - eligibleMessages.length,
        totalProcessed,
        totalSeeComm,
        totalSendFailed,
      },
    };
  },
};
