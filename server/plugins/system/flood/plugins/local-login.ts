import { registerFloodPlugin } from "../registry";
import { LOCAL_LOGIN_FLOOD_EVENT } from "../../../../flood/constants";

registerFloodPlugin({
  id: LOCAL_LOGIN_FLOOD_EVENT, name: "Local sign-in failures", singleton: true,
  description: "Limits failed local sign-ins per email and IP address. Successful sign-ins do not consume budget.",
  defaults: { threshold: 10, windowSeconds: 900 },
  getIdentifier(context) {
    if (!context.email || !context.ip) throw new Error("email and ip are required for local-login flood event");
    return `${context.email}|${context.ip}`;
  },
  async resolveIdentifierName(identifier) { return identifier.split("|")[0] || null; },
});
