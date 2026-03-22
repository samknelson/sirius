import { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { createWorkerDispatchEbaStorage, workerDispatchEbaLoggingConfig } from "../../storage/worker-dispatch-eba";
import { withStorageLogging } from "../../storage/middleware/logging";

export const dispatchEbaCleanupHandler: CronJobHandler = {
  description: 'Deletes worker EBA (availability) records that are more than 30 days in the past',
  requiresComponent: 'dispatch.eba',

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
};
