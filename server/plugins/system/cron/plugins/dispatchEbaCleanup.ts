import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";
import { createWorkerDispatchEbaStorage, workerDispatchEbaLoggingConfig } from "../../../../storage/dispatch/worker-eba";
import { withStorageLogging } from "../../../../storage/middleware/logging";

registerCronPlugin({
  metadata: {
    id: 'dispatch-eba-cleanup',
    name: 'Dispatch EBA Cleanup',
    description: 'Cleans up expired EBA (Employed but Available) dispatch entries',
    requiredComponent: 'dispatch.eba',
    singleton: true,
  },
  defaultSchedule: '0 4 * * *', // Daily at 4 AM
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const baseStorage = createWorkerDispatchEbaStorage();
    const ebaStorage = withStorageLogging(baseStorage, workerDispatchEbaLoggingConfig);

    const expiredEntries = await ebaStorage.findExpired(30);

    if (context.mode === 'test') {
      return {
        message: `Would delete ${expiredEntries.length} expired EBA entries`,
        metadata: { wouldDelete: expiredEntries.length },
      };
    }

    let deletedCount = 0;
    for (const entry of expiredEntries) {
      const deleted = await ebaStorage.delete(entry.id);
      if (deleted) {
        deletedCount++;
      }
    }

    return {
      message: `Deleted ${deletedCount} expired EBA entries`,
      metadata: { deletedCount },
    };
  },
});
