import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which webclient vendors the ledger will treat as payment gateways.
 *
 * The `wc-vendors` kind is component-neutral: any outside system this site
 * calls can be a vendor, and every operation a plugin declares is optional. The
 * ledger needs far more than that, and the gap fails QUIETLY — a vendor with no
 * customer or payment-method operations can be offered in a payment picker,
 * saved onto an account, and only refuse when someone finally tries to use it.
 * That is why this is pinned here rather than left to a type error or a crash.
 */

const getByKind = vi.fn();
const getConfig = vi.fn();
const getPlugin = vi.fn();
let enabledComponents = new Set<string>();

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      getByKind: (kind: string) => getByKind(kind),
      get: (id: string) => getConfig(id),
    },
  },
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  getComponentChecker: () => async (component: string) =>
    enabledComponents.has(component),
}));

vi.mock("../../server/plugins/wc-vendors", () => ({
  getWcVendorPlugin: (id: string) => getPlugin(id),
}));

const {
  PAYMENT_GATEWAY_OPERATIONS,
  isPaymentGatewayPlugin,
  listPaymentGatewayConfigs,
  checkPaymentGatewayConfig,
} = await import("../../server/modules/ledger/payment-gateway-capability");

type AnyPlugin = Parameters<typeof isPaymentGatewayPlugin>[0];

function operations(names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { operation: name, needsWritableDatabase: false, run: async () => undefined },
    ]),
  );
}

/** A full payment gateway, the shape the ledger was built against. */
function gatewayPlugin(over: Record<string, unknown> = {}): AnyPlugin {
  return {
    id: "stripe",
    name: "Stripe",
    requiredComponent: "ledger.stripe",
    supportedPaymentTypes: [{ id: "card", name: "Card" }],
    operations: operations([...PAYMENT_GATEWAY_OPERATIONS, "service.test-connection"]),
    ...over,
  } as unknown as AnyPlugin;
}

/**
 * A vendor that is not a payment gateway at all — the kind of plugin the
 * un-gated kind exists to allow. It can be reached and tested, and that is all.
 */
function nonPaymentPlugin(over: Record<string, unknown> = {}): AnyPlugin {
  return {
    id: "site-web-client",
    name: "Site Web Client",
    operations: operations(["service.test-connection"]),
    ...over,
  } as unknown as AnyPlugin;
}

function config(id: string, pluginId: string, over: Record<string, unknown> = {}) {
  return { id, pluginId, name: pluginId, enabled: true, pluginKind: "wc-vendors", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  enabledComponents = new Set(["ledger", "ledger.stripe"]);
});

describe("payment-gateway capability", () => {
  it("recognises a plugin that declares every operation the ledger calls", () => {
    expect(isPaymentGatewayPlugin(gatewayPlugin())).toBe(true);
  });

  it("rejects a vendor that can only be tested", () => {
    expect(isPaymentGatewayPlugin(nonPaymentPlugin())).toBe(false);
  });

  it("rejects a vendor missing even one payment operation", () => {
    for (const missing of PAYMENT_GATEWAY_OPERATIONS) {
      const partial = PAYMENT_GATEWAY_OPERATIONS.filter((n) => n !== missing);
      expect(
        isPaymentGatewayPlugin(gatewayPlugin({ operations: operations(partial) })),
      ).toBe(false);
    }
  });

  it("does not treat a payment-type catalog as proof of capability", () => {
    // A catalog only feeds the accepted-payment-types editor. Publishing one
    // says nothing about being able to create a customer.
    const catalogOnly = nonPaymentPlugin({
      supportedPaymentTypes: [{ id: "card", name: "Card" }],
    });
    expect(isPaymentGatewayPlugin(catalogOnly)).toBe(false);
  });
});

describe("the list ledger surfaces pick from", () => {
  it("omits a registered, enabled vendor that is not a payment gateway", async () => {
    getByKind.mockResolvedValue([
      config("cfg-stripe", "stripe"),
      config("cfg-other", "site-web-client"),
    ]);
    getPlugin.mockImplementation((id: string) =>
      id === "stripe" ? gatewayPlugin() : nonPaymentPlugin(),
    );

    const listed = await listPaymentGatewayConfigs();
    expect(listed.map((c) => c.id)).toEqual(["cfg-stripe"]);
  });

  it("still omits a disabled config and one whose plugin component is off", async () => {
    getByKind.mockResolvedValue([
      config("cfg-off", "stripe", { enabled: false }),
      config("cfg-gated", "stripe"),
    ]);
    getPlugin.mockReturnValue(gatewayPlugin());
    enabledComponents.delete("ledger.stripe");

    expect(await listPaymentGatewayConfigs()).toEqual([]);
  });

  it("lists a payment gateway with no catalog, but says it has none", async () => {
    // Capability and catalog are separate answers: this vendor can carry a
    // payment method, so an account may use it, but the payment-types editor
    // has nothing to show for it.
    getByKind.mockResolvedValue([config("cfg-bare", "stripe")]);
    getPlugin.mockReturnValue(gatewayPlugin({ supportedPaymentTypes: [] }));

    expect(await listPaymentGatewayConfigs()).toEqual([
      { id: "cfg-bare", pluginId: "stripe", name: "stripe", acceptsPaymentTypes: false },
    ]);
  });
});

describe("refusing a non-gateway on an account write", () => {
  it("accepts a payment gateway", async () => {
    getConfig.mockResolvedValue(config("cfg-stripe", "stripe"));
    getPlugin.mockReturnValue(gatewayPlugin());

    expect(await checkPaymentGatewayConfig("cfg-stripe")).toBeNull();
  });

  it("refuses a non-payment vendor and names what it cannot do", async () => {
    getConfig.mockResolvedValue(config("cfg-other", "site-web-client"));
    getPlugin.mockReturnValue(nonPaymentPlugin());

    const problem = await checkPaymentGatewayConfig("cfg-other");
    expect(problem?.status).toBe(400);
    expect(problem?.message).toContain("payments.customer.create");
  });

  it("refuses an id that is not a wc-vendors config at all", async () => {
    getConfig.mockResolvedValue(undefined);
    expect((await checkPaymentGatewayConfig("nope"))?.status).toBe(400);

    getConfig.mockResolvedValue(config("cfg-x", "stripe", { pluginKind: "web-service" }));
    expect((await checkPaymentGatewayConfig("cfg-x"))?.status).toBe(400);
  });

  it("refuses a gateway whose own component is switched off", async () => {
    getConfig.mockResolvedValue(config("cfg-stripe", "stripe"));
    getPlugin.mockReturnValue(gatewayPlugin());
    enabledComponents.delete("ledger.stripe");

    expect((await checkPaymentGatewayConfig("cfg-stripe"))?.message).toContain(
      "ledger.stripe",
    );
  });
});

describe("the neutral vendor surface stays neutral", () => {
  it("does not narrow the vendor list to payment gateways", () => {
    // The whole point of un-gating the kind is that a non-payment vendor is
    // reachable. If the neutral list ever borrowed the ledger's capability
    // filter, it would hide exactly the vendors the kind was opened up for.
    const neutral = readFileSync("server/modules/system/wc-vendors.ts", "utf8");
    expect(neutral).not.toContain("payment-gateway-capability");
    expect(neutral).not.toContain("isPaymentGatewayPlugin");
  });
});

describe("accepted payment type storage", () => {
  it("has no configuration-specific payment-types API after the editor move", () => {
    const routes = readFileSync("server/modules/ledger/wc-vendors.ts", "utf8");

    expect(routes).not.toContain("/:configId/payment-types");
    expect(routes).not.toContain("paymentTypes");
  });

  it("does not restore payment types from a retired global during startup", () => {
    const startup = readFileSync("server/app-init.ts", "utf8");
    const vendorPlugins = readFileSync("server/plugins/wc-vendors/index.ts", "utf8");

    expect(startup).not.toContain("backfillPaymentTypesFromGlobal");
    expect(vendorPlugins).not.toContain("backfillPaymentTypesFromGlobal");
    expect(startup).not.toContain("stripe_payment_methods");
    expect(vendorPlugins).not.toContain("stripe_payment_methods");
  });
});
