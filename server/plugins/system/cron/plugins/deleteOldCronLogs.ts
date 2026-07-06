import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

const RETENTION_DAYS = 30;

function getCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

registerCronPlugin({
  metadata: {
    id: 'delete-old-cron-logs',
    name: 'Delete Old Cron Logs',
    description: 'Deletes cron job run logs that are older than 30 days',
    singleton: true,
  },
  defaultSchedule: '0 3 * * *', // Daily at 3 AM
  defaultEnabled: true,

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
});
