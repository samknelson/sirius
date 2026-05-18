import type { DashboardPlugin } from "../types";

export const bookmarksPlugin: DashboardPlugin = {
  id: "bookmarks",
  name: "Bookmarks",
  description: "Display user's most recent bookmarks",
  client: {
    component: "bookmarks:Bookmarks",
    order: 2,
    requiredPermissions: ["bookmark", "admin"],
  },
};
