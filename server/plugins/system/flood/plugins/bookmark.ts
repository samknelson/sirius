import { registerFloodPlugin } from "../registry";

registerFloodPlugin({
  id: "bookmark", name: "Bookmarks", singleton: true,
  description: "Limits bookmark creation per user.",
  defaults: { threshold: 1000, windowSeconds: 360 },
  getIdentifier(context) {
    if (!context.userId) throw new Error("userId is required for bookmark flood event");
    return context.userId;
  },
  async resolveIdentifierName(identifier) {
    const { storage } = await import("../../../../storage");
    const user = await storage.users.getUser(identifier);
    return user ? (user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`.trim() : user.email || null) : null;
  },
});
