import { lt } from "drizzle-orm";
import { cronJobRuns } from "@shared/schema";
import { storage } from "../../../../storage";
import { registerDataRetentionPlugin } from "../registry";

/** Cron run logs older than this many days are deleted. */
const RETENTION_DAYS = 30;

/**
 * Deletes cron job run logs older than 30 days. Replaces the legacy
 * `delete-old-cron-logs` cron job.
 */
registerDataRetentionPlugin({
  metadata: {
    id: "delete-old-cron-logs",
    name: "Delete Old Cron Logs",
    description: `Deletes cron job run logs that are older than ${RETENTION_DAYS} days`,
    needsReadOnlyDb: true,
    singleton: true,
  },

  async cleanup(mode) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const oldRuns = await storage.readOnly.query(async (client) =>
      client
        .select({ id: cronJobRuns.id })
        .from(cronJobRuns)
        .where(lt(cronJobRuns.startedAt, cutoffDate)),
    );

    if (mode === "test") {
      return {
        count: oldRuns.length,
        message: `Would delete ${oldRuns.length} cron logs older than ${RETENTION_DAYS} days`,
        metadata: { retentionDays: RETENTION_DAYS, cutoffDate: cutoffDate.toISOString() },
      };
    }

    let deletedCount = 0;
    for (const run of oldRuns) {
      const deleted = await storage.cronJobRuns.delete(run.id);
      if (deleted) deletedCount++;
    }

    return {
      count: deletedCount,
      message: `Deleted ${deletedCount} cron logs older than ${RETENTION_DAYS} days`,
      metadata: { retentionDays: RETENTION_DAYS, cutoffDate: cutoffDate.toISOString() },
    };
  },
});
