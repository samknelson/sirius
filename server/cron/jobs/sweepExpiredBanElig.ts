import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";

const BAN_CATEGORY = "ban";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isBanCurrentlyActive(ban: { startDate: Date; endDate: Date | null }): boolean {
  const today = startOfDay(new Date());
  const startDay = startOfDay(new Date(ban.startDate));
  if (startDay > today) return false;
  if (!ban.endDate) return true;
  const endDay = startOfDay(new Date(ban.endDate));
  return endDay >= today;
}

export const sweepExpiredBanEligHandler: CronJobHandler = {
  description: 'Clears dispatch eligibility entries for expired worker bans',
  requiresComponent: 'dispatch.ban',

  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting expired ban eligibility sweep', {
      service: 'cron-sweep-ban-elig',
      jobId: context.jobId,
      mode: context.mode,
    });

    let workersProcessed = 0;
    let entriesRemoved = 0;

    try {
      const workerIds = await storage.workerDispatchEligDenorm.getDistinctWorkersByCategory(BAN_CATEGORY);

      for (const workerId of workerIds) {
        const bans = await storage.workerBans.getByWorker(workerId);

        const activeDispatchBans = bans.filter(
          ban => ban.type === "dispatch" && isBanCurrentlyActive(ban)
        );

        if (activeDispatchBans.length === 0) {
          if (context.mode === 'live') {
            const deleted = await storage.workerDispatchEligDenorm.deleteByWorkerAndCategory(workerId, BAN_CATEGORY);
            entriesRemoved += deleted;
          } else {
            const toDeleteCount = await storage.workerDispatchEligDenorm.countByWorkerAndCategory(workerId, BAN_CATEGORY);
            entriesRemoved += toDeleteCount;
          }
          
          logger.debug(`Cleared expired ban eligibility for worker`, {
            service: 'cron-sweep-ban-elig',
            workerId,
            mode: context.mode,
          });
        }

        workersProcessed++;
      }

      logger.info('Completed expired ban eligibility sweep', {
        service: 'cron-sweep-ban-elig',
        jobId: context.jobId,
        mode: context.mode,
        workersProcessed,
        entriesRemoved,
      });

      return {
        success: true,
        message: context.mode === 'live'
          ? `Processed ${workersProcessed} workers, removed ${entriesRemoved} expired ban eligibility entries`
          : `[TEST] Would process ${workersProcessed} workers, would remove ${entriesRemoved} expired ban eligibility entries`,
        stats: {
          workersProcessed,
          entriesRemoved,
        },
      };
    } catch (error) {
      logger.error('Failed to sweep expired ban eligibility', {
        service: 'cron-sweep-ban-elig',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message: `Failed to sweep expired ban eligibility: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
