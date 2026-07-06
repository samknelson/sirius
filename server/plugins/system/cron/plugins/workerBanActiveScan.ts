import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

registerCronPlugin({
  metadata: {
    id: 'worker-ban-active-scan',
    name: 'Worker Ban Active Scan',
    description: 'Scans worker bans and updates their active status based on expiration dates',
    singleton: true,
  },
  defaultSchedule: '0 6 * * *', // Daily at 6 AM
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const expiredButActive = await storage.workerBans.findExpiredButActive();
    const notExpiredButInactive = await storage.workerBans.findNotExpiredButInactive();

    const wouldDeactivate = expiredButActive.length;
    const wouldActivate = notExpiredButInactive.length;

    if (context.mode !== 'live') {
      return {
        message: `Would deactivate ${wouldDeactivate} expired bans, activate ${wouldActivate} valid bans`,
        metadata: { wouldDeactivate, wouldActivate },
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

    return {
      message: `Deactivated ${deactivatedCount} expired bans, activated ${activatedCount} valid bans`,
      metadata: { deactivatedCount, activatedCount },
    };
  },
});
