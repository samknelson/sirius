import { storage } from "../../../../storage";
import { listWcRequests, resolveWcDuration } from "../../../../services/webclient";
import type { WcCacheExpiry } from "../../../../storage/wc-cache";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * Deletes web client cache entries that are past their useful life.
 *
 * "Useful life" is not a retention setting of its own: it is the window each
 * request type already declares in the behavior registry. A success older than
 * its freshness window would be re-fetched by the next read that wanted it,
 * and a failure older than its remembered-for window is no longer holding
 * anything off. Keeping either one only grows the table.
 *
 * Rows whose (service, request type) has no registered behavior are left
 * alone and reported. Nothing here knows what a retired request type's window
 * used to be, and deleting on that ignorance is how a still-live entry written
 * by an older release disappears.
 */
registerCronPlugin({
  metadata: {
    id: "wc-cache-sweep",
    name: "Web Client Cache Sweep",
    description: "Deletes cached third-party responses past the window their request type declares",
    singleton: true,
  },
  defaultSchedule: "35 3 * * *", // Nightly, off the hour
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const now = Date.now();
    const behaviors = listWcRequests();

    const expiries: WcCacheExpiry[] = [];
    for (const behavior of behaviors) {
      const freshFor = await resolveWcDuration(behavior.freshFor);
      const failureRememberedFor = await resolveWcDuration(behavior.failureRememberedFor);
      expiries.push({
        service: behavior.service,
        requestType: behavior.requestType,
        successOlderThan: new Date(now - freshFor),
        failureOlderThan: new Date(now - failureRememberedFor),
      });
    }

    const known = new Set(expiries.map((e) => `${e.service}:${e.requestType}`));
    const present = await storage.wcCache.listRequestTypes();
    const unregistered = present.filter((p) => !known.has(`${p.service}:${p.requestType}`));

    if (context.mode === "test") {
      const expired = await storage.wcCache.countExpired(expiries);
      return {
        message: `Test mode: ${expired} expired web client cache entries would be deleted`,
        metadata: {
          expired,
          requestTypes: expiries.length,
          unregisteredRequestTypes: unregistered.length,
        },
      };
    }

    const deleted = await storage.wcCache.purgeExpired(expiries);
    return {
      message: `Deleted ${deleted} expired web client cache entries`,
      metadata: {
        deleted,
        requestTypes: expiries.length,
        unregisteredRequestTypes: unregistered.length,
        ...(unregistered.length
          ? { unregistered: unregistered.map((u) => `${u.service}:${u.requestType}`) }
          : {}),
      },
    };
  },
});
