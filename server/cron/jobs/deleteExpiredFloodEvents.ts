import { CronJobHandler, CronJobContext, CronJobResult } from "../registry";
import { storage } from "../../storage";

export const deleteExpiredFloodEventsHandler: CronJobHandler = {
  description: 'Deletes flood control events that have expired',
  
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
};
