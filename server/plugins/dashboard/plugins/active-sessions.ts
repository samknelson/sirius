import type { DashboardPlugin } from "../types";

export const activeSessionsPlugin: DashboardPlugin = {
  id: "active-sessions",
  name: "Active Sessions",
  description: "Display count of active users and their sessions",
  requiredPolicy: "admin",

  async content(ctx) {
    const sessions = await ctx.storage.sessions.getSessions();
    return { sessions };
  },

  client: {
    component: "active-sessions:ActiveSessions",
    order: 6,
    requiredPermissions: ["admin"],
  },
};
