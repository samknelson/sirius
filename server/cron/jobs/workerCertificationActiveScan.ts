import { storage } from "../../storage";
import { logger } from "../../logger";
import type { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";

export const workerCertificationActiveScanHandler: CronJobHandler = {
  description: 'Scans worker certifications and updates their active status based on expiration dates and status',

  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting worker certification active scan', {
      service: 'cron-worker-certification-active-scan',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      const expiredButActive = await storage.workerCertifications.findExpiredButActive();
      const notExpiredButInactive = await storage.workerCertifications.findNotExpiredButInactive();

      const wouldDeactivate = expiredButActive.length;
      const wouldActivate = notExpiredButInactive.length;

      if (context.mode !== 'live') {
        logger.info('[TEST MODE] Worker certification active scan - would update', {
          service: 'cron-worker-certification-active-scan',
          jobId: context.jobId,
          wouldDeactivate,
          wouldActivate,
        });

        return {
          mode: context.mode,
          wouldDeactivate,
          wouldActivate,
        };
      }

      let deactivatedCount = 0;
      let activatedCount = 0;

      for (const cert of expiredButActive) {
        await storage.workerCertifications.update(cert.id, {});
        deactivatedCount++;
      }

      for (const cert of notExpiredButInactive) {
        await storage.workerCertifications.update(cert.id, {});
        activatedCount++;
      }

      logger.info('Worker certification active scan completed', {
        service: 'cron-worker-certification-active-scan',
        jobId: context.jobId,
        deactivatedCount,
        activatedCount,
      });

      return {
        mode: context.mode,
        deactivatedCount,
        activatedCount,
      };

    } catch (error) {
      logger.error('Worker certification active scan failed', {
        service: 'cron-worker-certification-active-scan',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};
