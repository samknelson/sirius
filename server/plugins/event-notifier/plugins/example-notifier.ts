import type { EventNotifierPlugin } from "../types";
import { registerEventNotifier } from "../registry";

/**
 * Scaffolding-only example notifier (Task #457).
 *
 * It exists so the new `event-notifier` kind has a registered plugin to list
 * in its manifest and configure through the generic admin page. It does NOT
 * subscribe to any event or send anything yet — the event-bus subscription
 * and the comm send "wrapper" are deferred follow-up work.
 */
export const exampleEventNotifierPlugin: EventNotifierPlugin = {
  id: "example-notifier",
  name: "Example Event Notifier",
  description:
    "Scaffolding-only example. Does not subscribe to events or send anything yet.",
  order: 100,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      note: {
        type: "string",
        title: "Note",
        description:
          "Free-text note for this placeholder config. Has no effect yet.",
      },
    },
  },
  uiSchema: {
    note: { "ui:widget": "textarea", "ui:options": { rows: 3 } },
  },
};

registerEventNotifier(exampleEventNotifierPlugin);
