import { registerEventNotifier } from "../registry";
import { createUsageAlertNotifier } from "../web-usage-alert-notifier";
import { findWsClientCrossings } from "../usage-alert-crossings";
import {
  usageAlertConfigSchema,
  usageAlertUiSchema,
  WS_CLIENT_USAGE_ALERT_NOTIFIER_ID,
} from "../../../services/web-usage-alerts";

/**
 * Tells staff when one client has called us a lot today — "this client has
 * called us 5,000 times today".
 *
 * The numbers are the ones the "Web Services - Incoming by Client" dashboard
 * card already shows. The notifier wakes on the ten minute tick and reads them
 * itself; nothing outside it knows what these rules mean.
 */
export const wsClientUsageAlertNotifier = createUsageAlertNotifier({
  id: WS_CLIENT_USAGE_ALERT_NOTIFIER_ID,
  name: "Incoming Usage Alert (by Client)",
  description:
    "Notifies selected staff when today's incoming calls from a web service client reach a configured number.",
  statsPath: "/admin/ws/stats",
  findCrossings: findWsClientCrossings,
  phrase: (subject) => `Incoming calls from ${subject}`,
  configSchema: usageAlertConfigSchema({
    rulesDescription:
      "Each rule watches one calling client — optionally narrowed to a single operation — and alerts once a day when today's calls reach its number.",
    targetProperties: {
      clientId: {
        type: "string",
        title: "Client",
        description: "The client whose calls to us are counted.",
        "x-options-resource": "ws-client",
      },
      operation: {
        type: "string",
        title: "Operation (optional)",
        description:
          "Narrow the rule to one operation. Leave empty to count every operation that client calls.",
        "x-options-resource": "ws-operation",
      },
    },
    requiredTarget: ["clientId"],
  }),
  uiSchema: usageAlertUiSchema(["clientId", "operation"]),
});

registerEventNotifier(wsClientUsageAlertNotifier);
