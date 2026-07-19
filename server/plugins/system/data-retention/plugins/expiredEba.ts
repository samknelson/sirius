import { lt } from "drizzle-orm";
import { workerDispatchEba } from "@shared/schema";
import { storage } from "../../../../storage";
import {
  createWorkerDispatchEbaStorage,
  workerDispatchEbaLoggingConfig,
} from "../../../../storage/dispatch/worker-eba";
import { withStorageLogging } from "../../../../storage/middleware/logging";
import { registerDataRetentionPlugin } from "../registry";

/** EBA entries older than this many days are expired. */
const EXPIRY_DAYS = 30;

/**
 * Deletes expired EBA (Employed but Available) dispatch entries older than 30
 * days. Replaces the legacy `dispatch-eba-cleanup` cron job.
 */
registerDataRetentionPlugin({
  metadata: {
    id: "dispatch-eba-cleanup",
    name: "Dispatch EBA Cleanup",
    description: "Deletes expired EBA (Employed but Available) dispatch entries older than 30 days",
    requiredComponent: "dispatch.eba",
    needsReadOnlyDb: true,
    singleton: true,
  },

  async cleanup(mode) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - EXPIRY_DAYS);
    const cutoffYmd = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}-${String(cutoffDate.getDate()).padStart(2, "0")}`;

    const expiredEntries = await storage.readOnly.query(async (client) =>
      client
        .select({ id: workerDispatchEba.id })
        .from(workerDispatchEba)
        .where(lt(workerDispatchEba.ymd, cutoffYmd)),
    );

    if (mode === "test") {
      return {
        count: expiredEntries.length,
        message: `Would delete ${expiredEntries.length} expired EBA entries`,
      };
    }

    const ebaStorage = withStorageLogging(
      createWorkerDispatchEbaStorage(),
      workerDispatchEbaLoggingConfig,
    );

    let deletedCount = 0;
    for (const entry of expiredEntries) {
      const deleted = await ebaStorage.delete(entry.id);
      if (deleted) deletedCount++;
    }

    return {
      count: deletedCount,
      message: `Deleted ${deletedCount} expired EBA entries`,
    };
  },
});
