/**
 * What a usage alert promises, and what would silently break it.
 *
 * A usage alert notifier is woken by a heartbeat, not by something happening:
 * the ten minute tick says only that ten minutes have passed, and the notifier
 * re-reads the counters and re-raises the same crossing every time. Nothing
 * deduplicates the ticks. The whole guarantee that staff hear about a threshold
 * once — and hear about it again tomorrow, and hear about a second rule too —
 * lives in two small pure decisions: which rules a configuration is watching,
 * and what the composed message's send-once key is made of.
 *
 * Both fail quietly. A key that forgets the threshold means an admin who lowers
 * a limit below today's count is told nothing until midnight; a key that
 * forgets the day means the alert never comes back; a key that does not span
 * every crossing the message reports means the second rule to cross is
 * swallowed by the first one's key. None of that crashes, none of it fails
 * typecheck, and none of it shows up until somebody is not told something.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/lib/base-url", () => ({
  absoluteBaseUrl: () => "https://example.test",
  absoluteUrl: (relative: string) => `https://example.test${relative}`,
}));

import {
  parseWcUsageRules,
  parseWsClientUsageRules,
  parseWsPluginUsageRules,
  usageAlertMessageSendKey,
  usageAlertSendKey,
  wcTargetKey,
  wsClientTargetKey,
  wsPluginTargetKey,
} from "../../server/services/web-usage-alerts";
import { createUsageAlertNotifier } from "../../server/plugins/event-notifier/web-usage-alert-notifier";
import type { UsageCrossing } from "../../server/plugins/event-notifier/usage-alert-crossings";
import { EventType } from "../../server/services/event-bus";
import type {
  EventNotifierEventContext,
  EventNotifierPlugin,
} from "../../server/plugins/event-notifier/types";

import { getTodayYmd } from "../../shared/utils/date";

const CONFIG_ID = "config-1";
const TODAY = getTodayYmd();

const ONE: UsageCrossing = {
  subject: "Twilio / phone-lookup",
  targetKey: "wc:Twilio:phone-lookup",
  count: 1200,
  threshold: 1000,
};
const OTHER: UsageCrossing = {
  subject: "Twilio / send-sms",
  targetKey: "wc:Twilio:send-sms",
  count: 90,
  threshold: 50,
};

/**
 * A notifier whose counting is a fixture. Composition is what is under test
 * here; reading `wc_stats` is not, and cannot be, without a live database.
 */
function notifierFinding(crossings: UsageCrossing[]): EventNotifierPlugin {
  return createUsageAlertNotifier({
    id: "test-usage-alert",
    name: "Test Usage Alert",
    description: "",
    statsPath: "/admin/wc/stats",
    findCrossings: async () => crossings,
    phrase: (subject) => `Outgoing calls to ${subject}`,
    configSchema: {} as never,
    uiSchema: {} as never,
  });
}

function ctx(): EventNotifierEventContext {
  return {
    event: EventType.CRON_TICK_10M,
    payload: { period: "10m", slotStartedAt: new Date().toISOString(), late: false },
    configId: CONFIG_ID,
    configName: "Phone lookups",
  };
}

/** Wake the notifier the way a tick does, then compose one channel. */
async function wakeAndCompose(
  notifier: EventNotifierPlugin,
  medium: "email" | "sms" | "inapp",
  crossingsCtx = ctx(),
) {
  await notifier.shouldDispatch!(crossingsCtx, {});
  return notifier.getMessage!(medium, { contactId: "c" }, crossingsCtx, {});
}

describe("usage alert rules", () => {
  it("drops a rule with no target or a threshold nobody could reach", () => {
    const rules = parseWcUsageRules({
      rules: [
        { service: "Twilio", threshold: 1000 },
        { threshold: 1000 },
        { service: "Twilio", threshold: 0 },
        { service: "Twilio", threshold: 2.5 },
        { service: "   ", threshold: 5 },
        "not a rule",
      ],
    });
    expect(rules).toEqual([{ service: "Twilio", requestType: undefined, threshold: 1000 }]);
  });

  it("reads each surface's own target fields", () => {
    expect(
      parseWsClientUsageRules({ rules: [{ clientId: "c1", operation: "ping", threshold: 5 }] }),
    ).toEqual([{ clientId: "c1", operation: "ping", threshold: 5 }]);
    expect(parseWsPluginUsageRules({ rules: [{ pluginId: "ping-v1", threshold: 5 }] })).toEqual([
      { pluginId: "ping-v1", operation: undefined, threshold: 5 },
    ]);
    // A rule of another surface names nothing this parser can watch.
    expect(parseWsPluginUsageRules({ rules: [{ clientId: "c1", threshold: 5 }] })).toEqual([]);
  });

  it("names what was counted by its dimensions, not by where the rule sits", () => {
    expect(wcTargetKey({ service: "Twilio", threshold: 1 })).toBe("wc:Twilio:*");
    expect(wcTargetKey({ service: "Twilio", requestType: "phone-lookup", threshold: 1 })).toBe(
      "wc:Twilio:phone-lookup",
    );
    expect(wsClientTargetKey({ clientId: "c1", threshold: 1 })).toBe("ws-client:c1:*");
    expect(wsPluginTargetKey({ pluginId: "ping-v1", operation: "ping", threshold: 1 })).toBe(
      "ws-plugin:ping-v1:ping",
    );
    // Whole-service and narrowed rules are different things, and a client and
    // a plugin of the same name are too.
    expect(wcTargetKey({ service: "Twilio", threshold: 1 })).not.toBe(
      wcTargetKey({ service: "Twilio", requestType: "phone-lookup", threshold: 1 }),
    );
    expect(wsClientTargetKey({ clientId: "x", threshold: 1 })).not.toBe(
      wsPluginTargetKey({ pluginId: "x", threshold: 1 }),
    );
  });
});

describe("the send-once key", () => {
  const base = {
    configId: CONFIG_ID,
    ymd: "2026-09-01",
    targetKey: "wc:Twilio:phone-lookup",
    threshold: 1000,
  };

  it("is the same on the next tick over the same crossing", () => {
    expect(usageAlertSendKey(base)).toBe(usageAlertSendKey({ ...base }));
  });

  it("differs by day, so still-heavy traffic alerts again tomorrow", () => {
    expect(usageAlertSendKey({ ...base, ymd: "2026-09-02" })).not.toBe(usageAlertSendKey(base));
  });

  it("differs by threshold, so lowering a rule's number re-arms it today", () => {
    expect(usageAlertSendKey({ ...base, threshold: 900 })).not.toBe(usageAlertSendKey(base));
  });

  it("differs per rule and per configuration", () => {
    expect(usageAlertSendKey({ ...base, targetKey: "wc:Twilio:send-sms" })).not.toBe(
      usageAlertSendKey(base),
    );
    expect(usageAlertSendKey({ ...base, configId: "config-2" })).not.toBe(usageAlertSendKey(base));
  });
});

/**
 * One dispatch composes at most one message per recipient per channel, so a
 * configuration with two rules over their numbers reports both in one message.
 * The key has to span exactly what was reported.
 */
describe("the send-once key of a message reporting several crossings", () => {
  const base = { configId: CONFIG_ID, ymd: "2026-09-01" };

  it("is the plain one-crossing key when there is one crossing", () => {
    expect(usageAlertMessageSendKey({ ...base, crossings: [ONE] })).toBe(
      usageAlertSendKey({ ...base, targetKey: ONE.targetKey, threshold: ONE.threshold }),
    );
  });

  it("is not either crossing's own key, so neither is swallowed", () => {
    const both = usageAlertMessageSendKey({ ...base, crossings: [ONE, OTHER] });
    expect(both).not.toBe(usageAlertMessageSendKey({ ...base, crossings: [ONE] }));
    expect(both).not.toBe(usageAlertMessageSendKey({ ...base, crossings: [OTHER] }));
  });

  it("does not depend on the order the crossings were found in", () => {
    expect(usageAlertMessageSendKey({ ...base, crossings: [ONE, OTHER] })).toBe(
      usageAlertMessageSendKey({ ...base, crossings: [OTHER, ONE] }),
    );
  });

  it("still differs by day and by configuration", () => {
    const both = usageAlertMessageSendKey({ ...base, crossings: [ONE, OTHER] });
    expect(usageAlertMessageSendKey({ ...base, ymd: "2026-09-02", crossings: [ONE, OTHER] })).not.toBe(
      both,
    );
    expect(
      usageAlertMessageSendKey({ ...base, configId: "config-2", crossings: [ONE, OTHER] }),
    ).not.toBe(both);
  });
});

describe("a usage alert notifier woken by a tick", () => {
  it("says nothing when nothing is over its number", async () => {
    const notifier = notifierFinding([]);
    await expect(notifier.shouldDispatch!(ctx(), {})).resolves.toBe(false);
  });

  it("says what was counted, how many, and against which number", async () => {
    const email = await wakeAndCompose(notifierFinding([ONE]), "email");
    expect(email?.subject).toContain("Twilio / phone-lookup");
    expect(email?.bodyText).toContain("1200");
    expect(email?.bodyText).toContain("1000");
  });

  it("reports every crossing in the one message it is allowed to send", async () => {
    const email = await wakeAndCompose(notifierFinding([ONE, OTHER]), "email");
    for (const text of [ONE.subject, OTHER.subject, "1200", "90", "1000", "50"]) {
      expect(email?.bodyText).toContain(text);
    }
  });

  it("links absolutely off-app and relatively in-app", async () => {
    const notifier = notifierFinding([ONE]);
    expect((await wakeAndCompose(notifier, "email"))?.bodyText).toContain(
      "https://example.test/admin/wc/stats",
    );
    expect((await wakeAndCompose(notifier, "sms"))?.message).toContain(
      "https://example.test/admin/wc/stats",
    );
    expect((await wakeAndCompose(notifier, "inapp"))?.linkUrl).toBe("/admin/wc/stats");
  });

  it("carries one send-once key for every channel of one message", async () => {
    const notifier = notifierFinding([ONE, OTHER]);
    const shared = ctx();
    const expected = usageAlertMessageSendKey({
      configId: CONFIG_ID,
      ymd: TODAY,
      crossings: [ONE, OTHER],
    });
    for (const medium of ["email", "sms", "inapp"] as const) {
      const message = await wakeAndCompose(notifier, medium, shared);
      expect(message?.sendKey).toBe(expected);
    }
  });

  /**
   * The counters are read in `shouldDispatch` and reported in `getMessage`.
   * If what the first found does not reach the second, the message is composed
   * from nothing — which must be a refusal, never a message with the numbers
   * quietly missing.
   */
  it("refuses to compose a message nobody decided to send", async () => {
    const notifier = notifierFinding([ONE]);
    await expect(
      notifier.getMessage!("email", { contactId: "c" }, ctx(), {}),
    ).resolves.toBeNull();
  });
});
