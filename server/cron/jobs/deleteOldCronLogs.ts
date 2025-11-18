import { db } from "../../db";
import { cronJobRuns } from "@shared/schema";
import { lt } from "drizzle-orm";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext } from "../registry";

const RETENTION_DAYS = 30;

function getCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

export const deleteOldCronLogsHandler: CronJobHandler = {
  description: 'Deletes cron job run logs that are older than 30 days',
  
  async execute(context: CronJobContext): Promise<void> {
    logger.info('Starting old cron logs cleanup', {
      service: 'cron-delete-old-logs',
      jobId: context.jobId,
      retentionDays: RETENTION_DAYS,
    });

    try {
      const cutoffDate = getCutoffDate(RETENTION_DAYS);

      const deleted = await db
        .delete(cronJobRuns)
        .where(lt(cronJobRuns.startedAt, cutoffDate))
        .returning();

      logger.info('Old cron logs cleanup completed', {
        service: 'cron-delete-old-logs',
        jobId: context.jobId,
        totalDeleted: deleted.length,
        cutoffDate: cutoffDate.toISOString(),
        retentionDays: RETENTION_DAYS,
      });

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
