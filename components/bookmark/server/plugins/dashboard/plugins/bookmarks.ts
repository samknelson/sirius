import { registerDashboardPlugin } from "../../../../../../server/plugins/dashboard/registry";
import type { DashboardPlugin } from "../../../../../../server/plugins/dashboard/types";

export const bookmarksPlugin: DashboardPlugin = {
  id: "bookmarks",
  name: "Bookmarks",
  description: "Display user's most recent bookmarks",

  requiredComponent: "bookmark",
  // Preserve the existing per-user data boundary and presentation-only hint.
  // The API/page staff policy is intentionally not a new widget policy.
  async content(ctx) {
    const bookmarks = await ctx.storage.bookmarks.getEnrichedUserBookmarks(ctx.userId);
    return { bookmarks };
  },

  client: {
    component: "bookmarks:Bookmarks",
    order: 2,
    requiredPermissions: ["bookmark", "admin"],
  },
};

registerDashboardPlugin(bookmarksPlugin);
