import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

registerCronPlugin({
  metadata: {
    id: 'delete-expired-flood-events',
    name: 'Delete Expired Flood Events',
    description: 'Deletes flood control events that have expired',
    singleton: true,
  },
  defaultSchedule: '0 * * * *', // Every hour at minute 0
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    if (context.mode === 'test') {
      const allEvents = await storage.flood.listFloodEvents();
      const now = new Date();
      const expiredCount = allEvents.filter(e => e.expiresAt < now).length;

      return {
        message: `Would delete ${expiredCount} expired flood events`,
        metadata: { wouldDelete: expiredCount },
      };
    }

    const deletedCount = await storage.flood.cleanupExpired();

    return {
      message: `Deleted ${deletedCount} expired flood events`,
      metadata: { deletedCount },
    };
  },
});
