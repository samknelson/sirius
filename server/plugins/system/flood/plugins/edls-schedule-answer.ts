import { registerFloodPlugin } from "../registry";
import { EDLS_SCHEDULE_ANSWER_FLOOD_EVENT } from "../../../../flood/constants";

registerFloodPlugin({
  id: EDLS_SCHEDULE_ANSWER_FLOOD_EVENT, name: "EDLS schedule answers", singleton: true,
  requiredComponent: "edls",
  description: "Limits every public accept/decline attempt per schedule link and IP address, without sharing budget across workers' links.",
  defaults: { threshold: 30, windowSeconds: 900 },
  getIdentifier(context) {
    if (!context.scheduleId || !context.ip) throw new Error("scheduleId and ip are required for edls-schedule-answer flood event");
    return `${context.scheduleId}|${context.ip}`;
  },
  async resolveIdentifierName(identifier) { return identifier.split("|")[0] || null; },
});
