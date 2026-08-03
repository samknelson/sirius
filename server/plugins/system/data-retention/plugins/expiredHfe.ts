import { lt } from "drizzle-orm";
import { workerDispatchHfe } from "@shared/schema";
import { storage } from "../../../../storage";
import {
  createWorkerDispatchHfeStorage,
  workerDispatchHfeLoggingConfig,
} from "../../../../storage/dispatch/worker-hfe";
import { withStorageLogging } from "../../../../storage/middleware/logging";
import { registerDataRetentionPlugin } from "../registry";

/**
 * Deletes Hold for Employer entries whose hold date has passed. Replaces the
 * legacy `delete-expired-hfe` cron job.
 */
registerDataRetentionPlugin({
  metadata: {
    id: "delete-expired-hfe",
    name: "Delete Expired HFE Entries",
    description: "Deletes Hold for Employer entries where the hold date has passed",
    requiredComponent: "dispatch.hfe",
    needsReadOnlyDb: true,
    singleton: true,
  },

  async cleanup(mode) {
    const today = new Date().toISOString().split("T")[0];
    const expiredEntries = await storage.readOnly.query(async (client) =>
      client
        .select({ id: workerDispatchHfe.id })
        .from(workerDispatchHfe)
        .where(lt(workerDispatchHfe.holdUntil, today)),
    );

    if (mode === "test") {
      return {
        count: expiredEntries.length,
        message: `Would delete ${expiredEntries.length} expired HFE entries`,
      };
    }

    const hfeStorage = withStorageLogging(
      createWorkerDispatchHfeStorage(),
      workerDispatchHfeLoggingConfig,
    );

    let deletedCount = 0;
    for (const entry of expiredEntries) {
      const deleted = await hfeStorage.delete(entry.id);
      if (deleted) deletedCount++;
    }

    return {
      count: deletedCount,
      message: `Deleted ${deletedCount} expired HFE entries`,
    };
  },
});
