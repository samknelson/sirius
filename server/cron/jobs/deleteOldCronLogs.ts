import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";

const RETENTION_DAYS = 30;

function getCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

export const deleteOldCronLogsHandler: CronJobHandler = {
  description: 'Deletes cron job run logs that are older than 30 days',
  
  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting old cron logs cleanup', {
      service: 'cron-delete-old-logs',
      jobId: context.jobId,
      retentionDays: RETENTION_DAYS,
      mode: context.mode,
    });

    try {
      const cutoffDate = getCutoffDate(RETENTION_DAYS);

      let totalDeleted = 0;

      // In test mode, count but don't delete
      if (context.mode === 'test') {
        totalDeleted = await storage.cronJobRuns.countOldRuns(cutoffDate);

        logger.info('[TEST MODE] Old cron logs cleanup - would delete', {
          service: 'cron-delete-old-logs',
          jobId: context.jobId,
          totalDeleted,
          cutoffDate: cutoffDate.toISOString(),
          retentionDays: RETENTION_DAYS,
        });
      } else {
        // Live mode: actually delete the records
        totalDeleted = await storage.cronJobRuns.deleteOldRuns(cutoffDate);

        logger.info('Old cron logs cleanup completed', {
          service: 'cron-delete-old-logs',
          jobId: context.jobId,
          totalDeleted,
          cutoffDate: cutoffDate.toISOString(),
          retentionDays: RETENTION_DAYS,
        });
      }

      return {
        totalDeleted,
        retentionDays: RETENTION_DAYS,
        cutoffDate: cutoffDate.toISOString(),
        mode: context.mode,
      };

    } catch (error) {
      logger.error('Failed to delete old cron logs', {
        service: 'cron-delete-old-logs',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
