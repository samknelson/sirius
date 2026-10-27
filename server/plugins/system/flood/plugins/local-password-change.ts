import { registerFloodPlugin } from "../registry";
import { LOCAL_PASSWORD_CHANGE_FLOOD_EVENT } from "../../../../flood/constants";

registerFloodPlugin({
  id: LOCAL_PASSWORD_CHANGE_FLOOD_EVENT, name: "Local password-change failures", singleton: true,
  description: "Limits failed current-password verifications per user and IP. Successful password changes do not consume budget.",
  defaults: { threshold: 10, windowSeconds: 900 },
  getIdentifier(context) {
    if (!context.userId || !context.ip) throw new Error("userId and ip are required for local-password-change flood event");
    return `${context.userId}|${context.ip}`;
  },
  async resolveIdentifierName(identifier) { return identifier.split("|")[0] || null; },
});
