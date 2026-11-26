import { storage } from "../../../../../../../server/storage";
import { registerCronPlugin } from "../../../../../../../server/plugins/system/cron/registry";
import type { CronJobContext, CronJobResult } from "../../../../../../../server/plugins/system/cron/types";

registerCronPlugin({
  metadata: {
    id: 'worker-certification-active-scan',
    requiredComponent: "worker.certifications",
    requiredComponents: ["worker.skills"],
    name: 'Worker Certification Active Scan',
    description: 'Scans worker certifications and updates their active status based on expiration dates and status',
    singleton: true,
  },
  // Not seeded by the legacy bootstrap (no default row existed), so it defaults
  // to disabled. The schedule mirrors the worker-ban scan's daily 6 AM slot.
  defaultSchedule: '0 6 * * *',
  defaultEnabled: false,

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
});
