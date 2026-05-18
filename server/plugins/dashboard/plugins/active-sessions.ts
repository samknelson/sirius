import type { DashboardPlugin } from "../types";

export const activeSessionsPlugin: DashboardPlugin = {
  id: "active-sessions",
  name: "Active Sessions",
  description: "Display count of active users and their sessions",
  requiredPolicy: "admin",

  async content(ctx) {
    const sessions = await ctx.storage.sessions.getSessions();
    const now = Date.now();
    const active = sessions.filter((s) => new Date(s.expire).getTime() > now);

    const uniqueUsers = new Map<string, (typeof active)[number]>();
    for (const s of active) {
      if (s.userId && !uniqueUsers.has(s.userId)) uniqueUsers.set(s.userId, s);
    }

    const recentUsers = Array.from(uniqueUsers.values())
      .sort((a, b) => new Date(b.expire).getTime() - new Date(a.expire).getTime())
      .slice(0, 5)
      .map((s) => ({
        sid: s.sid,
        userId: s.userId,
        expire: s.expire,
        displayName:
          [s.userFirstName, s.userLastName].filter(Boolean).join(" ").trim() ||
          s.userEmail ||
          "Unknown User",
      }));

    return {
      activeUserCount: uniqueUsers.size,
      totalSessionCount: active.length,
      recentUsers,
    };
  },

  client: {
    component: "active-sessions:ActiveSessions",
    order: 6,
    requiredPermissions: ["admin"],
  },
};
