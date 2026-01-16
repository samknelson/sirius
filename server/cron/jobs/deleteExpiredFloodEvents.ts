import { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";
import { storage } from "../../storage";
import { logger } from "../../logger";

export const deleteExpiredFloodEventsHandler: CronJobHandler = {
  description: 'Deletes flood control events that have expired',
  
  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting expired flood events cleanup', {
      service: 'cron-delete-expired-flood-events',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      if (context.mode === 'test') {
        const allEvents = await storage.flood.listFloodEvents();
        const now = new Date();
        const expiredCount = allEvents.filter(e => e.expiresAt < now).length;

        logger.info('[TEST MODE] Expired flood events cleanup - would delete', {
          service: 'cron-delete-expired-flood-events',
          jobId: context.jobId,
          expiredCount,
        });

        return {
          mode: 'test',
          wouldDelete: expiredCount,
        };
      }

      const deletedCount = await storage.flood.cleanupExpired();

      logger.info('Expired flood events cleanup completed', {
        service: 'cron-delete-expired-flood-events',
        jobId: context.jobId,
        deletedCount,
      });

      return {
        mode: 'live',
        deletedCount,
      };

    } catch (error) {
      logger.error('Failed to delete expired flood events', {
        service: 'cron-delete-expired-flood-events',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
