import { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";
import { createWorkerDispatchHfeStorage, workerDispatchHfeLoggingConfig } from "../../storage/worker-dispatch-hfe";
import { withStorageLogging } from "../../storage/middleware/logging";
import { logger } from "../../logger";

export const deleteExpiredHfeHandler: CronJobHandler = {
  description: 'Deletes Hold for Employer entries where the hold date has passed',
  requiresComponent: 'dispatch.hfe',
  
  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting expired HFE entries cleanup', {
      service: 'cron-delete-expired-hfe',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      const baseStorage = createWorkerDispatchHfeStorage();
      const hfeStorage = withStorageLogging(baseStorage, workerDispatchHfeLoggingConfig);

      const expiredEntries = await hfeStorage.findExpired();

      if (context.mode === 'test') {
        logger.info('[TEST MODE] Expired HFE cleanup - would delete', {
          service: 'cron-delete-expired-hfe',
          jobId: context.jobId,
          expiredCount: expiredEntries.length,
        });

        return {
          mode: 'test',
          wouldDelete: expiredEntries.length,
        };
      }

      let deletedCount = 0;
      for (const entry of expiredEntries) {
        const deleted = await hfeStorage.delete(entry.id);
        if (deleted) {
          deletedCount++;
        }
      }

      logger.info('Expired HFE entries cleanup completed', {
        service: 'cron-delete-expired-hfe',
        jobId: context.jobId,
        deletedCount,
      });

      return {
        mode: 'live',
        deletedCount,
      };

    } catch (error) {
      logger.error('Failed to delete expired HFE entries', {
        service: 'cron-delete-expired-hfe',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
