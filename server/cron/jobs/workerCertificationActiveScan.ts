import { storage } from "../../storage";
import type { CronJobHandler, CronJobContext, CronJobResult } from "../registry";

export const workerCertificationActiveScanHandler: CronJobHandler = {
  description: 'Scans worker certifications and updates their active status based on expiration dates and status',

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const expiredButActive = await storage.workerCertifications.findExpiredButActive();
    const notExpiredButInactive = await storage.workerCertifications.findNotExpiredButInactive();

    const wouldDeactivate = expiredButActive.length;
    const wouldActivate = notExpiredButInactive.length;

    if (context.mode !== 'live') {
      return {
        message: `Would deactivate ${wouldDeactivate} expired certs, activate ${wouldActivate} valid certs`,
        metadata: { wouldDeactivate, wouldActivate },
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

    return {
      message: `Deactivated ${deactivatedCount} expired certs, activated ${activatedCount} valid certs`,
      metadata: { deactivatedCount, activatedCount },
    };
  },
};
