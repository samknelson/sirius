import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  config: null as any, canStore: vi.fn(), calls: vi.fn(), create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { pluginConfigs: {
    get: async (id: string) => id === h.config.id ? h.config : undefined,
    getByKindAndPlugin: async () => [h.config],
  } },
}));
vi.mock("../../server/storage/wc-stats", () => ({ wcStatsStorage: { recordCall: h.calls } }));
vi.mock("../../server/storage/wc-cache", async importOriginal => {
  const actual = await importOriginal<typeof import("../../server/storage/wc-cache")>();
  return { ...actual, wcCacheStorage: { ...actual.wcCacheStorage, canStore: h.canStore } };
});
vi.mock("../../server/plugins/_core/gating", () => ({ isPluginComponentEnabledAsync: async () => true }));
vi.mock("stripe", () => ({ default: class {
  paymentIntents = { create: h.create, retrieve: h.retrieve, cancel: h.cancel };
} }));

import "../../server/plugins/wc-vendors/plugins/stripe";
import "../../server/plugins/wc-vendors/plugins/dummy";
import { getWcVendorPlugin } from "../../server/plugins/wc-vendors/registry";
import { wcRequest } from "../../server/services/webclient";
import { setMaintenanceActive } from "../../server/services/maintenance-flag";
import { describeWcVendor } from "../../server/services/webclient/wc-vendor-context";
import { auditWcVendorHandlerFixture } from "../../scripts/dev/check-maintenance-guards";

const input = {
  sessionId: "attempt-boundary", amountMinor: 1000, currency: "USD", saveMethod: false,
  paymentTypes: ["card"], description: "Ledger payment", metadata: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  setMaintenanceActive(false);
  process.env.PAYMENT_BOUNDARY_TEST_KEY = "sk_test_boundary";
  h.config = { id: "payment-boundary", pluginKind: "wc-vendors", pluginId: "stripe",
    enabled: true, data: { secretName: "PAYMENT_BOUNDARY_TEST_KEY", publishableKey: "pk_test_boundary", paymentTypes: ["card"] } };
  h.canStore.mockResolvedValue(true);
  h.create.mockResolvedValue({ id: "pi_boundary", status: "requires_payment_method",
    amount: 1000, currency: "usd", client_secret: "test_client_secret" });
  h.retrieve.mockResolvedValue({ id: "pi_boundary", status: "processing", amount: 1000, currency: "usd" });
});

describe("checkout uses the WC vendor boundary", () => {
  it("audits private implementation wrapping without exempting metadata calls or raw exports", () => {
    const spec = { handlerContainers: ["provider"], handlerProperty: "run",
      directHandlerNames: ["createPaymentSession"], vendorIdentifiers: ["client"] };
    const provider = `const provider = {
      async createPaymentSession(ctx, args) { return client(ctx).create(args); },
      validateConfig() { return { valid: true }; }
    }; definePaymentVendor(provider);`;
    expect(auditWcVendorHandlerFixture(provider, spec)).toEqual([]);
    expect(auditWcVendorHandlerFixture(provider.replace("return { valid: true }", "return client().create()"), spec).length).toBeGreaterThan(0);
    expect(auditWcVendorHandlerFixture(`export ${provider}`, spec).length).toBeGreaterThan(0);
  });
  it("keeps provider runners out of public handles and declares save capability explicitly", () => {
    const stripe = getWcVendorPlugin("stripe")!;
    expect(stripe.operations["payments.session.create"]).not.toHaveProperty("run");
    expect(stripe).not.toHaveProperty("createPaymentSession");
    expect(stripe.reusableCheckoutPaymentTypes).toEqual(["card", "us_bank_account"]);
    expect(getWcVendorPlugin("dummy")!.reusableCheckoutPaymentTypes ?? []).toEqual([]);
  });
  it("uses one guarded, attributed, idempotent provider call", async () => {
    const result = await wcRequest({ vendor: { configId: h.config.id }, operation: "payments.session.create", args: input });
    expect(result).toMatchObject({ outcome: "success", value: { providerRef: "pi_boundary", status: "created" } });
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }), { idempotencyKey: input.sessionId });
    expect(h.calls).toHaveBeenCalledOnce();
  });
  it("refuses payment creation and cancellation before provider entry on a non-writable database", async () => {
    h.canStore.mockResolvedValue(false);
    for (const operation of ["payments.session.create", "payments.payment.cancel"] as const) {
      const result = await wcRequest({ vendor: { configId: h.config.id }, operation,
        args: operation === "payments.session.create" ? input : { providerRef: "pi_boundary" } } as never);
      expect(result.outcome).not.toBe("success");
    }
    expect(h.create).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
    expect((await wcRequest({ vendor: { configId: h.config.id }, operation: "payments.payment.retrieve",
      args: { providerRef: "pi_boundary" } })).outcome).toBe("success");
  });
  it("retains maintenance refusal even for explicitly targeted disabled recovery", async () => {
    h.config.enabled = false;
    setMaintenanceActive(true);
    try {
      await expect(wcRequest({ vendor: { configId: h.config.id, allowDisabled: true },
        operation: "payments.session.create", args: input })).rejects.toMatchObject({ service: "Stripe" });
    } finally { setMaintenanceActive(false); }
    expect(h.create).not.toHaveBeenCalled();
  });
  it("permits disabled recovery only when the exact configuration is explicitly named", async () => {
    h.config.enabled = false;
    await expect(describeWcVendor({ configId: h.config.id })).rejects.toMatchObject({ status: 409 });
    await expect(describeWcVendor({ pluginId: "stripe" })).rejects.toMatchObject({ status: 503 });
    expect((await wcRequest({ vendor: { configId: h.config.id, allowDisabled: true },
      operation: "payments.payment.retrieve", args: { providerRef: "pi_boundary" } })).outcome).toBe("success");
  });
  it("returns only non-secret configuration facts, with fingerprints bound to the credential", async () => {
    const read = () => wcRequest({ vendor: { configId: h.config.id }, operation: "payments.configuration.read", args: undefined });
    const first = await read();
    expect(first).toMatchObject({ outcome: "success", value: { isTestMode: true, paymentTypes: ["card"] } });
    expect(JSON.stringify(first)).not.toContain("sk_test_boundary");
    process.env.PAYMENT_BOUNDARY_TEST_KEY = "sk_test_changed";
    const second = await read();
    expect(second.value?.fingerprint).not.toBe(first.value?.fingerprint);
  });
});
