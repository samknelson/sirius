import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginConfig } from "@shared/schema";

const stripeRetrieve = vi.hoisted(() => vi.fn());
const stripeAttach = vi.hoisted(() => vi.fn());
const stripeDetach = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => ({
  default: class StripeMock {
    paymentMethods = {
      retrieve: stripeRetrieve,
      attach: stripeAttach,
      detach: stripeDetach,
    };
  },
}));

import { getWcVendorHandler } from "../../server/plugins/wc-vendors/registry";
import "../../server/plugins/wc-vendors/plugins/stripe";
import "../../server/plugins/wc-vendors/plugins/sitespecific-freeman-authorization";

function context(
  pluginId: string,
  credential: string,
  data: Record<string, unknown> = {},
) {
  return {
    credential: { secretName: "TEST_SECRET", value: credential },
    config: {
      id: `${pluginId}-config`,
      pluginKind: "wc-vendors",
      pluginId,
      enabled: true,
      ordering: 0,
      data,
    } as PluginConfig,
  };
}

function handler(pluginId: string, operation: string) {
  const found = getWcVendorHandler(pluginId, operation as never);
  if (!found) throw new Error(`Missing ${pluginId}.${operation} test handler`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("manual read provider safety", () => {
  it("pings Freeman with GET and without sending the configured bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      handler("sitespecific-freeman-authorization", "ping")(
        context(
          "sitespecific-freeman-authorization",
          "freeman-secret-canary",
          { authorizationUrl: "https://freeman.test/authorize" },
        ),
        {} as never,
      ),
    ).resolves.toMatchObject({
      success: true,
      outcome: "success",
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://freeman.test/authorize",
      expect.objectContaining({
        method: "GET",
        headers: undefined,
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "freeman-secret-canary",
    );
  });

  it("retrieves Stripe method details without invoking mutation methods", async () => {
    stripeRetrieve.mockResolvedValue({
      id: "pm_123",
      type: "card",
      card: { brand: "visa", last4: "4242" },
    });

    await expect(
      handler("stripe", "get-method-details")(
        context("stripe", "sk_test_example"),
        { methodRef: "pm_123" } as never,
      ),
    ).resolves.toMatchObject({
      paymentMethod: { id: "pm_123" },
      providerUrl: "https://dashboard.stripe.com/test/payment_methods/pm_123",
    });
    expect(stripeRetrieve).toHaveBeenCalledWith("pm_123");
    expect(stripeAttach).not.toHaveBeenCalled();
    expect(stripeDetach).not.toHaveBeenCalled();
  });
});