import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";

export const workerBanActiveScanHandler: CronJobHandler = {
  description: 'Scans worker bans and updates their active status based on expiration dates',

  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting worker ban active scan', {
      service: 'cron-worker-ban-active-scan',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      const expiredButActive = await storage.workerBans.findExpiredButActive();
      const notExpiredButInactive = await storage.workerBans.findNotExpiredButInactive();

      const wouldDeactivate = expiredButActive.length;
      const wouldActivate = notExpiredButInactive.length;

      if (context.mode !== 'live') {
        logger.info('[TEST MODE] Worker ban active scan - would update', {
          service: 'cron-worker-ban-active-scan',
          jobId: context.jobId,
          wouldDeactivate,
          wouldActivate,
        });

        return {
          mode: context.mode,
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

      logger.info('Worker ban active scan completed', {
        service: 'cron-worker-ban-active-scan',
        jobId: context.jobId,
        deactivatedCount,
        activatedCount,
      });

      return {
        mode: context.mode,
        deactivatedCount,
        activatedCount,
      };

    } catch (error) {
      logger.error('Worker ban active scan failed', {
        service: 'cron-worker-ban-active-scan',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
