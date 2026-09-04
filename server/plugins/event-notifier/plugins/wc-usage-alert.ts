import { registerEventNotifier } from "../registry";
import { createUsageAlertNotifier } from "../web-usage-alert-notifier";
import { findWcCrossings } from "../usage-alert-crossings";
import {
  usageAlertConfigSchema,
  usageAlertUiSchema,
  WC_USAGE_ALERT_NOTIFIER_ID,
} from "../../../services/web-usage-alerts";

/**
 * Tells staff when we have made a lot of calls to a third party today —
 * "we have made 1,000 Twilio phone-lookups today".
 *
 * The numbers are the ones the "Web Services - Outgoing" dashboard card
 * already shows. The notifier wakes on the ten minute tick and reads them
 * itself; nothing outside it knows what these rules mean.
 */
export const wcUsageAlertNotifier = createUsageAlertNotifier({
  id: WC_USAGE_ALERT_NOTIFIER_ID,
  name: "Outgoing Usage Alert",
  description:
    "Notifies selected staff when today's outbound calls to a third-party service reach a configured number.",
  statsPath: "/admin/wc/stats",
  findCrossings: findWcCrossings,
  phrase: (subject) => `Outgoing calls to ${subject}`,
  configSchema: usageAlertConfigSchema({
    rulesDescription:
      "Each rule watches one outgoing service — optionally narrowed to a single request type — and alerts once a day when today's calls reach its number.",
    targetProperties: {
      service: {
        type: "string",
        title: "Outgoing service",
        description: "The third-party service whose calls are counted.",
        "x-options-resource": "wc-service",
      },
      requestType: {
        type: "string",
        title: "Request type (optional)",
        description:
          "Narrow the rule to one request type of that service. Leave empty to count every request type.",
        "x-options-resource": "wc-request-type",
      },
    },
    requiredTarget: ["service"],
  }),
  uiSchema: usageAlertUiSchema(["service", "requestType"]),
});

registerEventNotifier(wcUsageAlertNotifier);
