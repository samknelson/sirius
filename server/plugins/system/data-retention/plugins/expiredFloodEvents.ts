import { lt } from "drizzle-orm";
import { flood } from "@shared/schema";
import { storage } from "../../../../storage";
import { registerDataRetentionPlugin } from "../registry";

/**
 * Deletes flood control events that have expired. Replaces the legacy
 * `delete-expired-flood-events` cron job.
 */
registerDataRetentionPlugin({
  metadata: {
    id: "delete-expired-flood-events",
    name: "Delete Expired Flood Events",
    description: "Deletes flood control events that have expired",
    needsReadOnlyDb: true,
    singleton: true,
  },

  async cleanup(mode) {
    const now = new Date();
    const expiredEvents = await storage.readOnly.query(async (client) =>
      client
        .select({ id: flood.id })
        .from(flood)
        .where(lt(flood.expiresAt, now)),
    );

    if (mode === "test") {
      return {
        count: expiredEvents.length,
        message: `Would delete ${expiredEvents.length} expired flood events`,
      };
    }

    let deletedCount = 0;
    for (const event of expiredEvents) {
      await storage.flood.deleteFloodEvent(event.id);
      deletedCount++;
    }

    return {
      count: deletedCount,
      message: `Deleted ${deletedCount} expired flood events`,
    };
  },
});
