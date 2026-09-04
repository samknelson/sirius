import { registerEventNotifier } from "../registry";
import { createUsageAlertNotifier } from "../web-usage-alert-notifier";
import { findWsPluginCrossings } from "../usage-alert-crossings";
import {
  usageAlertConfigSchema,
  usageAlertUiSchema,
  WS_PLUGIN_USAGE_ALERT_NOTIFIER_ID,
} from "../../../services/web-usage-alerts";

/**
 * Tells staff when one of our own web services has been called a lot today,
 * whoever called it.
 *
 * The numbers are the ones the "Web Services - Incoming by Service" dashboard
 * card already shows. The notifier wakes on the ten minute tick and reads them
 * itself; nothing outside it knows what these rules mean.
 */
export const wsPluginUsageAlertNotifier = createUsageAlertNotifier({
  id: WS_PLUGIN_USAGE_ALERT_NOTIFIER_ID,
  name: "Incoming Usage Alert (by Service)",
  description:
    "Notifies selected staff when today's incoming calls to one of our web services reach a configured number.",
  statsPath: "/admin/ws/stats",
  findCrossings: findWsPluginCrossings,
  phrase: (subject) => `Incoming calls to ${subject}`,
  configSchema: usageAlertConfigSchema({
    rulesDescription:
      "Each rule watches one web service — optionally narrowed to a single operation — and alerts once a day when today's calls reach its number.",
    targetProperties: {
      pluginId: {
        type: "string",
        title: "Web service",
        description: "The service plugin whose incoming calls are counted.",
        "x-options-resource": "ws-service-plugin",
      },
      operation: {
        type: "string",
        title: "Operation (optional)",
        description:
          "Narrow the rule to one of that service's operations. Leave empty to count every operation.",
        "x-options-resource": "ws-operation",
      },
    },
    requiredTarget: ["pluginId"],
  }),
  uiSchema: usageAlertUiSchema(["pluginId", "operation"]),
});

registerEventNotifier(wsPluginUsageAlertNotifier);
