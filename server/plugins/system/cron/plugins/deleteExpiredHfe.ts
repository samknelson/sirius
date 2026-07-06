import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { createWorkerDispatchHfeStorage, workerDispatchHfeLoggingConfig } from "../../../../storage/dispatch/worker-hfe";
import { withStorageLogging } from "../../../../storage/middleware/logging";

registerCronPlugin({
  metadata: {
    id: 'delete-expired-hfe',
    name: 'Delete Expired HFE Entries',
    description: 'Deletes Hold for Employer entries where the hold date has passed',
    requiredComponent: 'dispatch.hfe',
    singleton: true,
  },
  defaultSchedule: '0 4 * * *', // Daily at 4 AM
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const baseStorage = createWorkerDispatchHfeStorage();
    const hfeStorage = withStorageLogging(baseStorage, workerDispatchHfeLoggingConfig);

    const expiredEntries = await hfeStorage.findExpired();

    if (context.mode === 'test') {
      return {
        message: `Would delete ${expiredEntries.length} expired HFE entries`,
        metadata: { wouldDelete: expiredEntries.length },
      };
    }

    let deletedCount = 0;
    for (const entry of expiredEntries) {
      const deleted = await hfeStorage.delete(entry.id);
      if (deleted) {
        deletedCount++;
      }
    }

    return {
      message: `Deleted ${deletedCount} expired HFE entries`,
      metadata: { deletedCount },
    };
  },
});
