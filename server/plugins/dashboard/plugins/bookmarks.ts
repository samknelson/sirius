import type { DashboardPlugin } from "../types";

export const bookmarksPlugin: DashboardPlugin = {
  id: "bookmarks",
  name: "Bookmarks",
  description: "Display user's most recent bookmarks",

  // No policy/component gating: data is scoped to the caller by userId. The
  // widget is still hidden from users without the bookmark/admin permission
  // via the `requiredPermissions` UI hint on the manifest.
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
