import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { getTodayYmd } from "@shared/utils/date";

/**
 * Who is calling us, and how much.
 *
 * Per calling client only — what they called, and when, is what the admin
 * Incoming Stats page is for, and the card links there for it.
 */

/** Today plus the six days before it, inclusive. */
const WINDOW_DAYS = 7;

export const wsUsageByClientPlugin: DashboardPlugin = {
  id: "ws-usage-byclient",
  name: "Web Services - Incoming",
  // The name it shares with the by-service card says which direction the
  // traffic runs; this says which way it is broken out, and in the admin
  // configuration list it is the only thing telling the two cards apart.
  description: "Broken out by client",
  requiredPolicy: "admin",

  async content(ctx) {
    const today = getTodayYmd();
    const [usage, clients] = await Promise.all([
      ctx.storage.wsStats.usage({ end: today, days: WINDOW_DAYS }),
      ctx.storage.wsClients.getAll(),
    ]);

    // Clients are named, not numbered. A counted call always has a client that
    // still exists — the counter's rows go with the client they belong to —
    // but this stays defensive rather than asserting it, because a usage card
    // that throws is worse than one showing an id.
    const nameById = new Map(clients.map((client) => [client.id, client.name]));

    return {
      // Echoed so the card labels its own columns from the clock that counted
      // the figures, rather than working the window out a second time.
      start: usage.start,
      end: usage.end,
      windowDays: WINDOW_DAYS,
      // Already busiest-first, and already including a caller that was busy
      // earlier in the week but not today, which reports zero for today.
      rows: usage.byClient.map((row) => ({
        id: row.id,
        label: nameById.get(row.id) ?? row.id,
        today: row.today,
        week: row.window,
      })),
    };
  },

  client: {
    component: "ws-usage-byclient:WsUsageByClient",
    order: 43,
    requiredPermissions: ["admin"],
  },
};

registerDashboardPlugin(wsUsageByClientPlugin);
