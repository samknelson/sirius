import { storage } from "../../storage";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";

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

  async execute(context: CronJobContext): Promise<CronJobResult> {
    let workersProcessed = 0;
    let entriesRemoved = 0;

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
      }

      workersProcessed++;
    }

    const verb = context.mode === 'live' ? 'Removed' : 'Would remove';

    return {
      message: `${verb} ${entriesRemoved} expired ban eligibility entries from ${workersProcessed} workers`,
      metadata: { workersProcessed, entriesRemoved },
    };
  },
};
