import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export const syncBanActiveStatusHandler: CronJobHandler = {
  description: 'Synchronizes the active status of worker bans based on their expiration dates',

  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting ban active status sync', {
      service: 'cron-sync-ban-active-status',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      const today = startOfDay(new Date());

      if (context.mode === 'test') {
        const wouldDeactivate = await storage.workerBans.countExpiredButActive(today);
        const wouldActivate = await storage.workerBans.countActiveButMarkedInactive(today);

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

      const deactivatedCount = await storage.workerBans.deactivateExpiredBans(today);
      const activatedCount = await storage.workerBans.activateCurrentBans(today);

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
