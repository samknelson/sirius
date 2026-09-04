import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { getTodayYmd } from "@shared/utils/date";

/**
 * What other people are calling us for, per service.
 *
 * "Service" is the registered web-service plugin, which is what the counter
 * records and what the admin Incoming Stats page filters by. It is not the
 * individual configuration: several configurations can be backed by one
 * plugin, and which of them was addressed is not counted, so a per-
 * configuration figure here would be invented rather than measured.
 *
 * Per service only — the per-day and per-operation detail is what the Stats
 * page is for, and the card links there for it.
 */

/** Today plus the six days before it, inclusive. */
const WINDOW_DAYS = 7;

export const wsUsageByPluginPlugin: DashboardPlugin = {
  id: "ws-usage-byplugin",
  name: "Web Services - Incoming",
  // The name it shares with the by-client card says which direction the
  // traffic runs; this says which way it is broken out, and in the admin
  // configuration list it is the only thing telling the two cards apart.
  description: "Broken out by service",
  requiredPolicy: "admin",

  async content(ctx) {
    // Plain Ymd string arithmetic. The counter stores a day, so nothing on
    // this path has to decide what a day means, and the storage derives the
    // window's first day from the same value it counts "today" against.
    const today = getTodayYmd();
    const usage = await ctx.storage.wsStats.usage({ end: today, days: WINDOW_DAYS });

    return {
      // Echoed so the card labels its own columns from the clock that counted
      // the figures, rather than working the window out a second time.
      start: usage.start,
      end: usage.end,
      windowDays: WINDOW_DAYS,
      // Already busiest-first, and already including a service that was called
      // earlier in the week but not today, which reports zero for today.
      rows: usage.byPlugin.map((row) => ({
        id: row.id,
        label: row.id,
        today: row.today,
        week: row.window,
      })),
    };
  },

  client: {
    component: "ws-usage-byplugin:WsUsageByPlugin",
    order: 42,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(wsUsageByPluginPlugin);
