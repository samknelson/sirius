import { registerFloodPlugin } from "../registry";
import { QUICKSEARCH_FLOOD_EVENT } from "../../../../flood/constants";

registerFloodPlugin({
  id: QUICKSEARCH_FLOOD_EVENT, name: "Quicksearch", singleton: true,
  description: "Limits quicksearch requests per user (or IP fallback) to bound search-as-you-type database work.",
  defaults: { threshold: 120, windowSeconds: 60 },
  getIdentifier(context) {
    const id = context.userId || context.ip;
    if (!id) throw new Error("userId or ip is required for quicksearch flood event");
    return id;
  },
  async resolveIdentifierName(identifier) {
    const { storage } = await import("../../../../storage");
    const user = await storage.users.getUser(identifier);
    return user ? (user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`.trim() : user.email || null) : null;
  },
});
