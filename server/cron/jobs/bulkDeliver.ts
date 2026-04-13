import { z } from "zod";
import { storage } from "../../storage";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { deliverToParticipant } from "../../modules/bulk/deliver";
import { storageLogger } from "../../logger";
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

async function processCampaigns(context: CronJobContext, settings: BulkDeliverSettings): Promise<{
  campaignsProcessed: number;
  campaignsCompleted: number;
  campaignsFailed: number;
  totalProcessed: number;
  totalSeeComm: number;
  totalSendFailed: number;
}> {
  const now = new Date();
  let campaignsProcessed = 0;
  let campaignsCompleted = 0;
  let campaignsFailed = 0;
  let totalProcessed = 0;
  let totalSeeComm = 0;
  let totalSendFailed = 0;

  const queuedCampaigns = await storage.bulkCampaigns.getAll({ status: "queued" });
  const eligibleCampaigns = queuedCampaigns.filter(c => {
    if (!c.scheduledAt) return true;
    return new Date(c.scheduledAt) <= now;
  });

  if (context.mode === 'test') {
    return {
      campaignsProcessed: eligibleCampaigns.length,
      campaignsCompleted: 0,
      campaignsFailed: 0,
      totalProcessed: 0,
      totalSeeComm: 0,
      totalSendFailed: 0,
    };
  }

  for (const campaign of eligibleCampaigns) {
    campaignsProcessed++;

    try {
      await storage.bulkCampaigns.update(campaign.id, { status: "processing" });

      const campaignMessages = await storage.bulkCampaigns.getMessagesByCampaignId(campaign.id);

      let campaignHasPending = false;
      let campaignHadFailures = false;

      for (const msg of campaignMessages) {
        const batchKey = MEDIUM_BATCH_KEY[msg.medium];
        const batchSize = batchKey ? settings[batchKey] : 25;
        const pendingParticipants = await rawParticipantStorage.getPendingByMessageId(msg.id, batchSize);

        if (pendingParticipants.length > 0) {
          campaignHasPending = true;
        }

        for (const participant of pendingParticipants) {
          try {
            const result = await deliverToParticipant(storage, msg.id, participant.id);
            totalProcessed++;
            if (result.commId) {
              totalSeeComm++;
            } else {
              totalSendFailed++;
              campaignHadFailures = true;
            }
          } catch {
            totalSendFailed++;
            totalProcessed++;
            campaignHadFailures = true;
          }
        }
      }

      let stillHasPending = false;
      for (const msg of campaignMessages) {
        const remaining = await rawParticipantStorage.getPendingByMessageId(msg.id, 1);
        if (remaining.length > 0) {
          stillHasPending = true;
          break;
        }
      }

      if (!stillHasPending) {
        for (const msg of campaignMessages) {
          await storage.bulkMessages.update(msg.id, { status: "sent" });
        }

        await storage.bulkCampaigns.update(campaign.id, { status: "completed" });
        campaignsCompleted++;

        storageLogger.info("Campaign delivery completed", {
          module: "bulk_campaign",
          operation: "delivery_complete",
          host_entity_id: campaign.id,
          campaign_name: campaign.name,
        });
      } else {
        await storage.bulkCampaigns.update(campaign.id, { status: "queued" });
      }
    } catch (error) {
      campaignsFailed++;
      await storage.bulkCampaigns.update(campaign.id, { status: "failed" });

      storageLogger.error("Campaign delivery failed", {
        module: "bulk_campaign",
        operation: "delivery_error",
        host_entity_id: campaign.id,
        campaign_name: campaign.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { campaignsProcessed, campaignsCompleted, campaignsFailed, totalProcessed, totalSeeComm, totalSendFailed };
}

export const bulkDeliverHandler: CronJobHandler = {
  description: 'Delivers queued bulk messages and campaigns to pending participants in batches',
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
    const standaloneMessages = queuedMessages.filter(msg => !msg.campaignId);
    const eligibleMessages = standaloneMessages.filter((msg) => {
      if (!msg.sendDate) return true;
      return new Date(msg.sendDate) <= now;
    });

    let totalSeeComm = 0;
    let totalSendFailed = 0;
    let totalProcessed = 0;

    if (context.mode === 'test') {
      let totalPending = 0;
      const messageSummaries: Array<{ id: string; name: string; medium: string; pendingCount: number; batchSize: number }> = [];

      for (const msg of eligibleMessages) {
        const batchKey = MEDIUM_BATCH_KEY[msg.medium];
        const batchSize = batchKey ? settings[batchKey] : 25;
        const pending = await rawParticipantStorage.getPendingByMessageId(msg.id, batchSize);
        totalPending += pending.length;
        messageSummaries.push({
          id: msg.id,
          name: msg.name,
          medium: msg.medium,
          pendingCount: pending.length,
          batchSize,
        });
      }

      const campaignResult = await processCampaigns(context, settings);

      return {
        message: `Would process ${totalPending} participants across ${eligibleMessages.length} standalone messages and ${campaignResult.campaignsProcessed} campaigns`,
        metadata: {
          standaloneMessages: eligibleMessages.length,
          campaignsEligible: campaignResult.campaignsProcessed,
          totalPending,
          messages: messageSummaries,
        },
      };
    }

    for (const msg of eligibleMessages) {
      const batchKey = MEDIUM_BATCH_KEY[msg.medium];
      const batchSize = batchKey ? settings[batchKey] : 25;
      const pendingParticipants = await rawParticipantStorage.getPendingByMessageId(msg.id, batchSize);

      for (const participant of pendingParticipants) {
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

    const campaignResult = await processCampaigns(context, settings);

    const grandTotalProcessed = totalProcessed + campaignResult.totalProcessed;
    const grandTotalSeeComm = totalSeeComm + campaignResult.totalSeeComm;
    const grandTotalSendFailed = totalSendFailed + campaignResult.totalSendFailed;

    return {
      message: `Processed ${grandTotalProcessed} participants: ${grandTotalSeeComm} see_comm, ${grandTotalSendFailed} send_failed (${eligibleMessages.length} standalone + ${campaignResult.campaignsProcessed} campaigns, ${campaignResult.campaignsCompleted} completed)`,
      metadata: {
        standaloneMessages: eligibleMessages.length,
        campaignsProcessed: campaignResult.campaignsProcessed,
        campaignsCompleted: campaignResult.campaignsCompleted,
        campaignsFailed: campaignResult.campaignsFailed,
        totalProcessed: grandTotalProcessed,
        totalSeeComm: grandTotalSeeComm,
        totalSendFailed: grandTotalSendFailed,
      },
    };
  },
};
