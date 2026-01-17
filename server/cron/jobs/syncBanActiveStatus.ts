import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";

export const syncBanActiveStatusHandler: CronJobHandler = {
  description: 'Synchronizes the active status of worker bans based on their expiration dates',

  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting ban active status sync', {
      service: 'cron-sync-ban-active-status',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      const expiredButActive = await storage.workerBans.findExpiredButActive();
      const notExpiredButInactive = await storage.workerBans.findNotExpiredButInactive();

      const wouldDeactivate = expiredButActive.length;
      const wouldActivate = notExpiredButInactive.length;

      if (context.mode === 'test') {
        logger.info('[TEST MODE] Ban active status sync - would update', {
          service: 'cron-sync-ban-active-status',
          jobId: context.jobId,
          wouldDeactivate,
          wouldActivate,
        });

        return {
          mode: 'test',
          wouldDeactivate,
          wouldActivate,
        };
      }

      let deactivatedCount = 0;
      let activatedCount = 0;

      for (const ban of expiredButActive) {
        await storage.workerBans.update(ban.id, {});
        deactivatedCount++;
      }

      for (const ban of notExpiredButInactive) {
        await storage.workerBans.update(ban.id, {});
        activatedCount++;
      }

      logger.info('Ban active status sync completed', {
        service: 'cron-sync-ban-active-status',
        jobId: context.jobId,
        deactivatedCount,
        activatedCount,
      });

      return {
        mode: 'live',
        deactivatedCount,
        activatedCount,
      };

    } catch (error) {
      logger.error('Failed to sync ban active status', {
        service: 'cron-sync-ban-active-status',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
