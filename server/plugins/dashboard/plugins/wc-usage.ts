import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { addDaysYmd, getTodayYmd } from "@shared/utils/date";

/**
 * Which external services we are actually calling, and how much.
 *
 * Per service only: the request-type breakdown is what the admin Web Client
 * Stats page is for, and the card links there for it.
 *
 * The counts come from the counter table through the storage layer, never
 * from the response cache — the cache holds one row per request key carrying
 * only the last attempt, and an uncached request type never writes to it, so
 * no honest call count can be derived from it.
 */

/** Today plus the six days before it, inclusive. */
const WINDOW_DAYS = 7;

export const wcUsagePlugin: DashboardPlugin = {
  id: "wc-usage",
  name: "Web Services - Outgoing",
  description:
    "Outbound calls per external service: today, and over the last 7 days.",
  requiredPolicy: "admin",

  async content(ctx) {
    // Plain Ymd string arithmetic. The counter stores a day, so nothing on
    // this path has to decide what a day means, and nothing converts one
    // through a Date.
    const today = getTodayYmd();
    const start = addDaysYmd(today, -(WINDOW_DAYS - 1));

    const [week, todayCounts] = await Promise.all([
      ctx.storage.wcStats.countsByService({ start, end: today }),
      ctx.storage.wcStats.countsByService({ start: today, end: today }),
    ]);

    // The 7-day window decides who appears: a service called earlier in the
    // week but not today belongs on the card, reporting zero for today.
    const todayByService = new Map(todayCounts.map((row) => [row.service, row.calls]));
    const services = week
      .map((row) => ({
        service: row.service,
        today: todayByService.get(row.service) ?? 0,
        week: row.calls,
      }))
      .sort((a, b) => b.week - a.week || a.service.localeCompare(b.service));

    return {
      // Echoed so the card can label its own columns honestly rather than
      // working the window out a second time against a different clock.
      today,
      start,
      end: today,
      windowDays: WINDOW_DAYS,
      services,
      todayTotal: services.reduce((sum, s) => sum + s.today, 0),
      weekTotal: services.reduce((sum, s) => sum + s.week, 0),
    };
  },

  client: {
    component: "wc-usage:WcUsage",
    order: 41,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(wcUsagePlugin);
