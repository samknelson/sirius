import { db } from "../../db";
import { workerBans } from "@shared/schema";
import { eq, and, lt, gte, or, isNull, isNotNull } from "drizzle-orm";
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
        const expiredButActive = await db
          .select({ id: workerBans.id })
          .from(workerBans)
          .where(and(
            eq(workerBans.active, true),
            isNotNull(workerBans.endDate),
            lt(workerBans.endDate, today)
          ));

        const activeButMarkedInactive = await db
          .select({ id: workerBans.id })
          .from(workerBans)
          .where(and(
            eq(workerBans.active, false),
            or(
              isNull(workerBans.endDate),
              gte(workerBans.endDate, today)
            )
          ));

        logger.info('[TEST MODE] Ban active status sync - would update', {
          service: 'cron-sync-ban-active-status',
          jobId: context.jobId,
          wouldDeactivate: expiredButActive.length,
          wouldActivate: activeButMarkedInactive.length,
        });

        return {
          mode: 'test',
          wouldDeactivate: expiredButActive.length,
          wouldActivate: activeButMarkedInactive.length,
        };
      }

      const deactivateResult = await db
        .update(workerBans)
        .set({ active: false })
        .where(and(
          eq(workerBans.active, true),
          isNotNull(workerBans.endDate),
          lt(workerBans.endDate, today)
        ));

      const activateResult = await db
        .update(workerBans)
        .set({ active: true })
        .where(and(
          eq(workerBans.active, false),
          or(
            isNull(workerBans.endDate),
            gte(workerBans.endDate, today)
          )
        ));

      const deactivatedCount = deactivateResult.rowCount ?? 0;
      const activatedCount = activateResult.rowCount ?? 0;

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
