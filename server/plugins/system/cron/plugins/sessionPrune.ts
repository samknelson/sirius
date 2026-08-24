import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * Deletes expired rows from the `sessions` table. Replaces connect-pg-simple's
 * in-process pruneSessionInterval now that session persistence goes through
 * the storage layer (StorageSessionStore). Expired sessions are already
 * invisible to the store's `get` (it filters on expire), so pruning is pure
 * garbage collection.
 */
registerCronPlugin({
  metadata: {
    id: "session-prune",
    name: "Session Prune",
    description: "Deletes expired login sessions from the sessions table",
    singleton: true,
  },
  defaultSchedule: "*/15 * * * *", // Every 15 minutes (connect-pg-simple's default cadence)
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const expiredSids = await storage.sessions.getExpiredSessionSids();

    if (context.mode === "test") {
      return {
        message: `Test mode: ${expiredSids.length} expired sessions would be deleted`,
        metadata: { expired: expiredSids.length },
      };
    }

    // Delete one at a time through the logged storage facade so each
    // session gets its own "Deleted session ... (expired)" lifecycle entry.
    // deleteExpiredSession re-checks expiry atomically, so a session that
    // was renewed after the candidate scan above survives (and isn't logged).
    let deleted = 0;
    for (const sid of expiredSids) {
      if ((await storage.sessions.deleteExpiredSession(sid)).deleted) deleted++;
    }
    return {
      message: `Deleted ${deleted} expired sessions`,
      metadata: { deleted },
    };
  },
});
