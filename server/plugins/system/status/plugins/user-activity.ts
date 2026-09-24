import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

registerSystemStatusPlugin({
  id: "user.activity",
  name: "User Activity",
  description:
    "Total users, users who logged in recently, and currently active sessions.",
  // Three cheap COUNT queries whose answers drift constantly — recompute on
  // every collect instead of caching.
  scanMode: "immediate",
  async scan(): Promise<StatusMessage[]> {
    const { storage } = await import("../../../../storage");
    const now = Date.now();
    const [totalUsers, loggedIn24h, loggedIn48h, activeSessions] =
      await Promise.all([
        storage.users.countUsers(),
        storage.users.countUsersLoggedInSince(new Date(now - DAY_MS)),
        storage.users.countUsersLoggedInSince(new Date(now - 2 * DAY_MS)),
        storage.sessions.countActiveSessions(),
      ]);

    const messages: StatusMessage[] = [
      {
        priority: "info",
        title: `${totalUsers} active user${totalUsers === 1 ? "" : "s"}, ${loggedIn24h} logged in within 24h`,
        details:
          `Active user accounts: ${totalUsers}. ` +
          `Distinct users who logged in within the last 24 hours: ${loggedIn24h}. ` +
          `Active (unexpired) sessions: ${activeSessions} — note sessions last up to a week, so this counts anyone with a live cookie, not just recent logins.`,
      },
    ];

    if (loggedIn48h === 0) {
      messages.push({
        priority: "notice",
        title: "No user logins in the last 48 hours",
        details:
          "No user account has a recorded login within the last 48 hours.",
      });
    }

    return messages;
  },
});
