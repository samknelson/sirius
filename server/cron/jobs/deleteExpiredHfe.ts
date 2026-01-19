import { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { createWorkerDispatchHfeStorage, workerDispatchHfeLoggingConfig } from "../../storage/worker-dispatch-hfe";
import { withStorageLogging } from "../../storage/middleware/logging";

export const deleteExpiredHfeHandler: CronJobHandler = {
  description: 'Deletes Hold for Employer entries where the hold date has passed',
  requiresComponent: 'dispatch.hfe',
  
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
};
