/**
 * What a usage alert promises, and what would silently break it.
 *
 * The scan re-raises the same crossing on every pass, on purpose. Nothing
 * deduplicates the events; the whole guarantee that staff hear about a
 * threshold once — and hear about it again tomorrow, and hear about a second
 * rule separately — lives in two small pure decisions: which crossings a
 * notifier claims as its own, and what its composed message's send-once key is
 * made of.
 *
 * Both fail quietly. A key that forgets the threshold means an admin who lowers
 * a limit below today's count is told nothing until midnight; a key that
 * forgets the day means the alert never comes back; a notifier that does not
 * filter on its configuration means two configurations answer each other's
 * crossings. None of that crashes, none of it fails typecheck, and none of it
 * shows up until somebody is not told something.
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
  usageAlertSendKey,
  wcTargetKey,
  wsClientTargetKey,
  wsPluginTargetKey,
} from "../../server/services/web-usage-alerts";
import { wcUsageAlertNotifier } from "../../server/plugins/event-notifier/plugins/wc-usage-alert";
import { wsClientUsageAlertNotifier } from "../../server/plugins/event-notifier/plugins/ws-usage-client-alert";
import { EventType } from "../../server/services/event-bus";
import type { EventNotifierEventContext } from "../../server/plugins/event-notifier/types";

const CONFIG_ID = "config-1";

function crossingContext(overrides: Record<string, unknown> = {}) {
  return {
    event: EventType.WEB_USAGE_THRESHOLD_REACHED,
    payload: {
      surface: "wc",
      configId: CONFIG_ID,
      ymd: "2026-09-01",
      subject: "Twilio / phone-lookup",
      targetKey: "wc:Twilio:phone-lookup",
      count: 1200,
      threshold: 1000,
      ...((overrides.payload as Record<string, unknown>) ?? {}),
    },
    configId: CONFIG_ID,
    configName: "Phone lookups",
    ...overrides,
  } as unknown as EventNotifierEventContext;
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

  it("is the same on the next scan of the same crossing", () => {
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

describe("a usage alert notifier", () => {
  it("claims its own configuration's crossings and no others", async () => {
    const data = {};
    await expect(wcUsageAlertNotifier.shouldDispatch!(crossingContext(), data)).resolves.toBe(true);
    await expect(
      wcUsageAlertNotifier.shouldDispatch!(crossingContext({ configId: "config-2" }), data),
    ).resolves.toBe(false);
    // Same configuration, another surface's crossing: not this notifier's.
    await expect(
      wcUsageAlertNotifier.shouldDispatch!(
        crossingContext({ payload: { surface: "ws-client" } }),
        data,
      ),
    ).resolves.toBe(false);
    await expect(
      wsClientUsageAlertNotifier.shouldDispatch!(crossingContext(), data),
    ).resolves.toBe(false);
  });

  it("says what was counted, how many, and against which number", async () => {
    const ctx = crossingContext();
    const email = await wcUsageAlertNotifier.getMessage!("email", { contactId: "c" }, ctx, {});
    expect(email?.subject).toContain("Twilio / phone-lookup");
    expect(email?.bodyText).toContain("1200");
    expect(email?.bodyText).toContain("1000");
  });

  it("links absolutely off-app and relatively in-app", async () => {
    const ctx = crossingContext();
    const recipient = { contactId: "c" };
    const email = await wcUsageAlertNotifier.getMessage!("email", recipient, ctx, {});
    const sms = await wcUsageAlertNotifier.getMessage!("sms", recipient, ctx, {});
    const inapp = await wcUsageAlertNotifier.getMessage!("inapp", recipient, ctx, {});
    expect(email?.bodyText).toContain("https://example.test/admin/wc/stats");
    expect(sms?.message).toContain("https://example.test/admin/wc/stats");
    expect(inapp?.linkUrl).toBe("/admin/wc/stats");
  });

  it("carries one send-once key for every channel of one crossing", async () => {
    const ctx = crossingContext();
    const recipient = { contactId: "c" };
    const expected = usageAlertSendKey({
      configId: CONFIG_ID,
      ymd: "2026-09-01",
      targetKey: "wc:Twilio:phone-lookup",
      threshold: 1000,
    });
    for (const medium of ["email", "sms", "inapp"] as const) {
      const message = await wcUsageAlertNotifier.getMessage!(medium, recipient, ctx, {});
      expect(message?.sendKey).toBe(expected);
    }
  });
});
