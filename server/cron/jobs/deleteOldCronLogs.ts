import { storage } from "../../storage";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";

const RETENTION_DAYS = 30;

function getCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

export const deleteOldCronLogsHandler: CronJobHandler = {
  description: 'Deletes cron job run logs that are older than 30 days',
  
  async execute(context: CronJobContext): Promise<CronJobResult> {
    const cutoffDate = getCutoffDate(RETENTION_DAYS);

    if (context.mode === 'test') {
      const wouldDelete = await storage.cronJobRuns.countOldRuns(cutoffDate);

      return {
        message: `Would delete ${wouldDelete} cron logs older than ${RETENTION_DAYS} days`,
        metadata: { wouldDelete, retentionDays: RETENTION_DAYS, cutoffDate: cutoffDate.toISOString() },
      };
    }

    const totalDeleted = await storage.cronJobRuns.deleteOldRuns(cutoffDate);

    return {
      message: `Deleted ${totalDeleted} cron logs older than ${RETENTION_DAYS} days`,
      metadata: { totalDeleted, retentionDays: RETENTION_DAYS, cutoffDate: cutoffDate.toISOString() },
    };
  },
};
