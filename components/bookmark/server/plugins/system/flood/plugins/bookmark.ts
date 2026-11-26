import { registerFloodPlugin } from "../../../../../../../server/plugins/system/flood/registry";

registerFloodPlugin({
  id: "bookmark", name: "Bookmarks", singleton: true,
  requiredComponent: "bookmark",
  description: "Limits bookmark creation per user.",
  defaults: { threshold: 1000, windowSeconds: 360 },
  getIdentifier(context) {
    if (!context.userId) throw new Error("userId is required for bookmark flood event");
    return context.userId;
  },
  async resolveIdentifierName(identifier) {
    const { storage } = await import("../../../../../../../server/storage");
    const user = await storage.users.getUser(identifier);
    return user ? (user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`.trim() : user.email || null) : null;
  },
});
