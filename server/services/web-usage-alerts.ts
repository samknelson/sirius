import type { JsonSchema, UiSchema } from "@shared/json-schema-form";

/**
 * The vocabulary the three usage-alert notifiers share.
 *
 * A usage alert watches ONE number: how many calls a dimension has counted
 * TODAY. The counters (`wc_stats` outgoing, `ws_stats` incoming) are the only
 * source, and nothing here changes how they are written.
 *
 * Everything in this module is PURE — rule shapes, the JSON Schema each
 * notifier offers its admin, and the two identities a crossing needs: the
 * `targetKey` naming what was counted and the send-once key that makes what a
 * message reports deliverable exactly once. Reading the counters is a separate
 * job and lives with the notifiers, in
 * `server/plugins/event-notifier/usage-alert-crossings.ts`; keeping this side
 * pure is what lets the keys be reasoned about and tested on their own.
 */

/** Notifier watching outgoing (third-party) calls, per the `wc-usage` card. */
export const WC_USAGE_ALERT_NOTIFIER_ID = "wc-usage-alert";
/** Notifier watching incoming calls per calling client, per `ws-usage-byclient`. */
export const WS_CLIENT_USAGE_ALERT_NOTIFIER_ID = "ws-usage-client-alert";
/** Notifier watching incoming calls per service plugin, per `ws-usage-byplugin`. */
export const WS_PLUGIN_USAGE_ALERT_NOTIFIER_ID = "ws-usage-plugin-alert";

/** Outgoing: a service, optionally narrowed to one of its request types. */
export interface WcUsageRule {
  service: string;
  requestType?: string;
  threshold: number;
}

/** Incoming: a calling client, optionally narrowed to one operation. */
export interface WsClientUsageRule {
  clientId: string;
  operation?: string;
  threshold: number;
}

/** Incoming: a service plugin, optionally narrowed to one operation. */
export interface WsPluginUsageRule {
  pluginId: string;
  operation?: string;
  threshold: number;
}

/** Read `data.rules` off a configuration payload; anything else is no rules. */
function ruleObjects(configData: unknown): Record<string, unknown>[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const rules = data.rules;
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
}

/** A non-empty trimmed string, or undefined. */
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A whole number of calls above zero, or undefined. */
function threshold(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

/**
 * The rules a configuration actually watches.
 *
 * Save-time validation refuses a rule with no target or a non-positive
 * threshold, so an unusable rule should never be stored; these parsers drop
 * one anyway rather than alerting on a rule nobody could have meant.
 */
export function parseWcUsageRules(configData: unknown): WcUsageRule[] {
  const rules: WcUsageRule[] = [];
  for (const raw of ruleObjects(configData)) {
    const service = text(raw.service);
    const count = threshold(raw.threshold);
    if (!service || count === undefined) continue;
    rules.push({ service, requestType: text(raw.requestType), threshold: count });
  }
  return rules;
}

export function parseWsClientUsageRules(configData: unknown): WsClientUsageRule[] {
  const rules: WsClientUsageRule[] = [];
  for (const raw of ruleObjects(configData)) {
    const clientId = text(raw.clientId);
    const count = threshold(raw.threshold);
    if (!clientId || count === undefined) continue;
    rules.push({ clientId, operation: text(raw.operation), threshold: count });
  }
  return rules;
}

export function parseWsPluginUsageRules(configData: unknown): WsPluginUsageRule[] {
  const rules: WsPluginUsageRule[] = [];
  for (const raw of ruleObjects(configData)) {
    const pluginId = text(raw.pluginId);
    const count = threshold(raw.threshold);
    if (!pluginId || count === undefined) continue;
    rules.push({ pluginId, operation: text(raw.operation), threshold: count });
  }
  return rules;
}

/** Stands in for "every request type / operation" inside a target key. */
const ANY = "*";

/**
 * What a rule counts, as one stable string.
 *
 * It is built from the dimensions themselves rather than from a rule's
 * position in the list, so re-ordering or re-saving the configuration cannot
 * turn one already-sent crossing into a second unsent one.
 */
export function wcTargetKey(rule: WcUsageRule): string {
  return `wc:${rule.service}:${rule.requestType ?? ANY}`;
}

export function wsClientTargetKey(rule: WsClientUsageRule): string {
  return `ws-client:${rule.clientId}:${rule.operation ?? ANY}`;
}

export function wsPluginTargetKey(rule: WsPluginUsageRule): string {
  return `ws-plugin:${rule.pluginId}:${rule.operation ?? ANY}`;
}

/**
 * The send-once key for one crossing, for one recipient, on one channel.
 *
 * Four things identify it, and each is there for a reason the task states:
 * the CONFIGURATION (two configurations watching the same number each get
 * their message), the DAY (still-heavy traffic alerts again tomorrow), WHAT
 * was counted (a second rule in the same configuration sends its own message)
 * and the THRESHOLD (an admin who lowers a number re-arms it for today rather
 * than waiting for midnight).
 *
 * The recipient and the channel are not in the key: the comm layer's
 * uniqueness is per (medium, contact, key), so one crossing still reaches
 * every chosen recipient on every chosen channel exactly once.
 */
export function usageAlertSendKey(crossing: {
  configId: string;
  ymd: string;
  targetKey: string;
  threshold: number;
}): string {
  return `usage-alert:${crossing.configId}:${crossing.ymd}:${crossing.targetKey}:${crossing.threshold}`;
}

/**
 * The send-once key for a MESSAGE, which may report more than one crossing.
 *
 * A dispatch composes at most one message per recipient per channel, so a
 * configuration with two rules over their numbers says both things in one
 * message — and the key has to span exactly the set it reported, or the second
 * crossing is silently swallowed by the first one's key.
 *
 * A single crossing keeps the one-crossing key unchanged, so the common case
 * behaves as it always has and keys already spent today stay spent.
 *
 * The set is sorted, so the same crossings in a different order are the same
 * message. A LATER crossing makes a new set and therefore a new message, which
 * restates the earlier crossing alongside the new one: telling somebody a
 * number again is the acceptable failure here, and not telling them the second
 * number is not.
 */
export function usageAlertMessageSendKey(message: {
  configId: string;
  ymd: string;
  crossings: { targetKey: string; threshold: number }[];
}): string {
  const [only] = message.crossings;
  if (message.crossings.length === 1) {
    return usageAlertSendKey({
      configId: message.configId,
      ymd: message.ymd,
      targetKey: only.targetKey,
      threshold: only.threshold,
    });
  }
  const parts = message.crossings
    .map((crossing) => `${crossing.targetKey}@${crossing.threshold}`)
    .sort();
  return `usage-alert:${message.configId}:${message.ymd}:set:${parts.join(",")}`;
}

/** The recipients field every staff notifier shares. */
const staffRecipients: JsonSchema = {
  type: "array",
  title: "Recipients",
  description:
    "Staff or admin users who are notified when one of the rules below is reached.",
  items: { type: "string" },
  "x-widget": "staff-recipients",
} as JsonSchema;

/** The threshold field every rule shares. */
const thresholdField: JsonSchema = {
  type: "integer",
  title: "Alert when today's calls reach",
  description: "A whole number of calls, at least 1.",
  minimum: 1,
};

/**
 * Which of a rule's fields are pickers.
 *
 * The form only infers a widget from `x-options-resource` for a top-level
 * field and for the properties of a nested OBJECT — it does not walk into an
 * array's items, and a rule is an array item. So each notifier says here which
 * of its rule fields are picked from an option list; without this they would
 * render as free-text boxes.
 */
export function usageAlertUiSchema(targetFields: string[]): UiSchema {
  return {
    rules: {
      items: Object.fromEntries(
        targetFields.map((field) => [field, { "ui:widget": "remoteOptions" }]),
      ),
    },
  };
}

/**
 * A usage-alert configuration: who to tell, and the list of rules to watch.
 *
 * One configuration holds many rules, so a single alert configuration can
 * watch several numbers and may send several messages in a day; an admin who
 * wants a second channel at a higher number creates a second configuration.
 *
 * `required` on the target field and `minimum` on the threshold are what
 * refuse a rule with no target or a non-positive number at save time — the
 * kind's `validateConfig` runs this schema against every write, including a
 * direct API one.
 */
export function usageAlertConfigSchema(options: {
  /** The rule's target fields, in the order the admin should read them. */
  targetProperties: Record<string, JsonSchema>;
  /** Which of those fields a rule cannot be saved without. */
  requiredTarget: string[];
  /** What this notifier's rules watch, for the list's description. */
  rulesDescription: string;
}): JsonSchema {
  return {
    type: "object",
    properties: {
      staffRecipientUserIds: staffRecipients,
      rules: {
        type: "array",
        title: "Alert rules",
        description: options.rulesDescription,
        items: {
          type: "object",
          title: "Rule",
          properties: {
            ...options.targetProperties,
            threshold: thresholdField,
          },
          required: [...options.requiredTarget, "threshold"],
        },
      },
    },
  };
}
