import { z } from "zod";
import { storage } from "../../../../storage";
import { registerDataRetentionPlugin } from "../registry";
import type { DataRetentionPlugin } from "../types";

export const DEFAULT_SESSION_HISTORY_RETENTION_DAYS = 365;
export const SESSION_HISTORY_CLEANUP_LIMIT = 1000;

const settingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(36500).default(DEFAULT_SESSION_HISTORY_RETENTION_DAYS),
});

export const sessionHistoryRetentionPlugin: DataRetentionPlugin = {
  metadata: {
    id: "delete-old-session-history",
    name: "Session History Retention",
    description:
      "Permanently deletes session history older than the configured retention period. Default: 1 year (365 days). Enable to activate cleanup; live sessions are not deleted.",
    requiredComponent: "system.session_history",
    singleton: true,
  },
  // This is a new, destructive policy: operators must explicitly opt in.
  defaultEnabled: false,
  getDefaultSettings: () => ({ retentionDays: DEFAULT_SESSION_HISTORY_RETENTION_DAYS }),
  configSchema: {
    type: "object",
    properties: {
      retentionDays: {
        type: "integer",
        title: "Retention period (days)",
        description:
          "History older than this period is permanently deleted when enabled. Default: 1 year (365 days). At most 1,000 records are deleted per sweep; dry runs make no changes.",
        minimum: 1,
        maximum: 36500,
        default: DEFAULT_SESSION_HISTORY_RETENTION_DAYS,
      },
    },
  },

  async cleanup(mode, settings = {}) {
    const parsed = settingsSchema.safeParse(settings);
    if (!parsed.success) {
      // Do not relay invalid stored payloads into the sweep's error logs.
      throw new Error("Session history retention must be a whole number of days between 1 and 36500");
    }
    const { retentionDays } = parsed.data;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const metadata = {
      retentionDays,
      cutoffDate: cutoff.toISOString(),
      limit: SESSION_HISTORY_CLEANUP_LIMIT,
    };

    if (mode === "test") {
      const eligibleCount = await storage.sessionHistory.countBefore(cutoff);
      const count = Math.min(eligibleCount, SESSION_HISTORY_CLEANUP_LIMIT);
      return {
        count,
        message: `Would delete up to ${count} of ${eligibleCount} expired session history records (retention: ${retentionDays} days)`,
        metadata: { ...metadata, eligibleCount },
      };
    }

    const ids = await storage.sessionHistory.getExpiredIds(cutoff, SESSION_HISTORY_CLEANUP_LIMIT);
    let count = 0;
    for (const id of ids) {
      if (await storage.sessionHistory.deleteExpired(id, cutoff)) count++;
    }
    return {
      count,
      message: `Deleted ${count} expired session history records (retention: ${retentionDays} days; limit: ${SESSION_HISTORY_CLEANUP_LIMIT})`,
      metadata,
    };
  },
};

registerDataRetentionPlugin(sessionHistoryRetentionPlugin);
