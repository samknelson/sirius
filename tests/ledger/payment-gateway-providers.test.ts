import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PaymentInitiationRejected, type PaymentGatewayContext } from "../../server/plugins/ledger/payment-gateway/types";
import { dummyPaymentGatewayPlugin } from "../../server/plugins/ledger/payment-gateway/plugins/dummy";
import {
  normalizeStripePaymentIntent,
  normalizeStripePaymentStatus,
  normalizeStripeWebhookEvent,
  stripePaymentGatewayPlugin,
} from "../../server/plugins/ledger/payment-gateway/plugins/stripe";

const { stripeCreate, stripeRetrieve, stripeCancel } = vi.hoisted(() => ({
  stripeCreate: vi.fn(), stripeRetrieve: vi.fn(), stripeCancel: vi.fn(),
}));
vi.mock("stripe", () => ({
  default: class {
    paymentIntents = { create: stripeCreate, retrieve: stripeRetrieve, cancel: stripeCancel };
  },
}));

const context = {
  apiKey: "",
  config: { id: "dummy-config", data: {} },
} as PaymentGatewayContext;

describe("payment gateway provider contract", () => {
  it.each(["test", "live"])("cancels an unconfirmed %s administrator payment only after verifying its provider provenance", async mode => {
    const ctx = { apiKey: `sk_${mode}_fixture`, config: { id: "stripe",
      data: { publishableKey: `pk_${mode}_fixture` } } } as PaymentGatewayContext;
    const intent = { id: "pi_admin", status: "requires_payment_method", livemode: mode === "live",
      amount: 12500, currency: "usd", metadata: { paymentPurpose: "admin_assisted", attemptId: "admin-attempt" } };
    stripeRetrieve.mockReset().mockResolvedValue(intent);
    stripeCancel.mockReset().mockResolvedValue({ ...intent, status: "canceled" });
    await expect(stripePaymentGatewayPlugin.cancelPayment!(ctx, "pi_admin", { adminAssistedAttemptId: "admin-attempt" }))
      .resolves.toMatchObject({ providerRef: "pi_admin", status: "canceled", amountMinor: 12500 });
    expect(stripeRetrieve).toHaveBeenCalledWith("pi_admin");
    expect(stripeCancel).toHaveBeenCalledWith("pi_admin");
  });
  it("still refuses live cancellation for ordinary and historical test flows without provider entry", async () => {
    stripeRetrieve.mockClear();
    stripeCancel.mockClear();
    const ctx = { apiKey: "sk_live_fixture", config: { id: "stripe",
      data: { publishableKey: "pk_live_fixture" } } } as PaymentGatewayContext;
    await expect(stripePaymentGatewayPlugin.cancelPayment!(ctx, "pi_ordinary"))
      .rejects.toMatchObject({ code: "credentials_not_ready" });
    expect(stripeRetrieve).not.toHaveBeenCalled();
    expect(stripeCancel).not.toHaveBeenCalled();
  });
  it.each([
    { metadata: { paymentPurpose: "admin_test", attemptId: "admin-attempt" } },
    { metadata: { paymentPurpose: "online_checkout", attemptId: "admin-attempt" } },
    { metadata: { paymentPurpose: "admin_assisted", attemptId: "other-attempt" } },
    { livemode: false },
    { id: "pi_another" },
    { status: "processing" },
    { status: "succeeded" },
  ])("does not cancel a live payment with mismatched administrator provenance or confirmed state %j", async overrides => {
    stripeRetrieve.mockReset().mockResolvedValue({
      id: "pi_admin", status: "requires_payment_method", livemode: true,
      metadata: { paymentPurpose: "admin_assisted", attemptId: "admin-attempt" }, ...overrides,
    });
    stripeCancel.mockClear();
    const ctx = { apiKey: "sk_live_fixture", config: { id: "stripe",
      data: { publishableKey: "pk_live_fixture" } } } as PaymentGatewayContext;
    await expect(stripePaymentGatewayPlugin.cancelPayment!(ctx, "pi_admin", { adminAssistedAttemptId: "admin-attempt" }))
      .rejects.toMatchObject({ code: "payment_not_cancelable" });
    expect(stripeCancel).not.toHaveBeenCalled();
  });
  it("refuses mismatched live cancellation credentials before provider entry", async () => {
    stripeRetrieve.mockClear();
    stripeCancel.mockClear();
    const ctx = { apiKey: "sk_live_fixture", config: { id: "stripe",
      data: { publishableKey: "pk_test_fixture" } } } as PaymentGatewayContext;
    await expect(stripePaymentGatewayPlugin.cancelPayment!(ctx, "pi_admin", { adminAssistedAttemptId: "admin-attempt" }))
      .rejects.toMatchObject({ code: "credentials_not_ready" });
    expect(stripeRetrieve).not.toHaveBeenCalled();
    expect(stripeCancel).not.toHaveBeenCalled();
  });
  it.each(["test", "live"])("permits matching %s keys only for administrator-on-behalf sessions", async mode => {
    const ctx = { apiKey: `sk_${mode}_fixture`, config: { id: "stripe",
      data: { publishableKey: `pk_${mode}_fixture`, paymentTypes: ["card", "us_bank_account"] } } } as PaymentGatewayContext;
    const args = { sessionId: "admin-on-behalf", amountMinor: 12500, currency: "USD",
      saveMethod: false, paymentTypes: ["card"], description: "Administrator payment on behalf of worker",
      metadata: { paymentPurpose: "admin_assisted" } };
    stripeCreate.mockReset().mockResolvedValue({
      id: "pi_fixture", status: "requires_payment_method", client_secret: "cs_fixture",
      amount: 12500, currency: "usd",
    });
    await expect(stripePaymentGatewayPlugin.createPaymentSession!(ctx, args)).resolves.toMatchObject({
      providerRef: "pi_fixture", status: "created",
    });
    expect(stripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 12500, currency: "usd", confirm: undefined,
      metadata: expect.objectContaining({ paymentPurpose: "admin_assisted" }),
    }), { idempotencyKey: "admin-on-behalf" });
    stripeCreate.mockClear();
    if (mode === "live") {
      for (const metadata of [{}, { paymentPurpose: "admin_test" }] as Record<string, string>[]) {
        await expect(stripePaymentGatewayPlugin.createPaymentSession!(ctx, { ...args, metadata }))
          .rejects.toMatchObject({ code: "credentials_not_ready" });
      }
      expect(stripeCreate).not.toHaveBeenCalled();
    }
  });
  it.each([
    ["sk_live_fixture", "pk_test_fixture"], ["sk_test_fixture", "pk_live_fixture"],
    ["unknown", "pk_live_fixture"], ["sk_live_fixture", ""],
  ])("refuses mismatched administrator keys %s / %s before provider entry", async (apiKey, publishableKey) => {
    stripeCreate.mockClear();
    const ctx = { apiKey, config: { id: "stripe", data: { publishableKey, paymentTypes: ["card"] } } } as PaymentGatewayContext;
    await expect(stripePaymentGatewayPlugin.createPaymentSession!(ctx, {
      sessionId: "admin-on-behalf", amountMinor: 12500, currency: "USD", saveMethod: false,
      paymentTypes: ["card"], description: "Administrator payment", metadata: { paymentPurpose: "admin_assisted" },
    })).rejects.toMatchObject({ code: "credentials_not_ready" });
    expect(stripeCreate).not.toHaveBeenCalled();
  });
  it.each([{ saveMethod: true }, { savedMethodRef: "pm_worker" }, { customerRef: "cus_worker" }])(
    "refuses saved-method use in administrator provider entry %j", async extras => {
      stripeCreate.mockClear();
      const ctx = { apiKey: "sk_live_fixture", config: { id: "stripe",
        data: { publishableKey: "pk_live_fixture", paymentTypes: ["card"] } } } as PaymentGatewayContext;
      await expect(stripePaymentGatewayPlugin.createPaymentSession!(ctx, {
        sessionId: "admin-on-behalf", amountMinor: 12500, currency: "USD", saveMethod: false,
        paymentTypes: ["card"], description: "Administrator payment", metadata: { paymentPurpose: "admin_assisted" }, ...extras,
      })).rejects.toMatchObject({ code: "saved_method_not_allowed" });
      expect(stripeCreate).not.toHaveBeenCalled();
    },
  );
  it("requires matching provider-specific Stripe test-key signals", () => {
    const testContext = {
      apiKey: "sk_test_fixture",
      config: { id: "stripe", data: { publishableKey: "pk_test_fixture" } },
    } as PaymentGatewayContext;
    expect(stripePaymentGatewayPlugin.isTestMode?.(testContext)).toBe(true);
    expect(stripePaymentGatewayPlugin.isTestMode?.({
      ...testContext, config: { ...testContext.config, data: { publishableKey: "pk_live_fixture" } },
    })).toBe(false);
    expect(stripePaymentGatewayPlugin.isTestMode?.({
      ...testContext, apiKey: "sk_live_fixture",
    })).toBe(false);
    expect(dummyPaymentGatewayPlugin.isTestMode?.(testContext)).toBe(true);
  });

  it.each([stripePaymentGatewayPlugin, dummyPaymentGatewayPlugin])("distinguishes absent from explicitly empty methods for $150 at $id", async plugin => {
    const ctx = { apiKey: "sk_test_fixture", config: { id: "fixture", data: { publishableKey: "pk_test_fixture" } } } as PaymentGatewayContext;
    expect(plugin.getCheckoutPaymentTypes!(ctx)).toContain("card");
    ctx.config.data = { publishableKey: "pk_test_fixture", paymentTypes: [] };
    expect(plugin.getCheckoutPaymentTypes!(ctx)).toEqual([]);
    const input = { sessionId: "rejected", amountMinor: 15000, currency: "USD", saveMethod: false,
      paymentTypes: ["card"], description: "Ledger payment", metadata: {} };
    expect(() => plugin.validatePaymentSession!(ctx, input)).toThrow(PaymentInitiationRejected);
    stripeCreate.mockClear();
    await expect(plugin.createPaymentSession!(ctx, input)).rejects.toMatchObject({ code: "method_disabled" });
    expect(stripeCreate).not.toHaveBeenCalled();
  });
  it("makes dummy sessions deterministic and recoverable without process state", async () => {
    const args = {
      sessionId: "checkout-123",
      amountMinor: 1250,
      currency: "usd",
      saveMethod: false,
      paymentTypes: ["card"],
      description: "Account payment",
      metadata: { dummyOutcome: "processing" },
    };
    const first = await dummyPaymentGatewayPlugin.createPaymentSession!(context, args);
    const second = await dummyPaymentGatewayPlugin.createPaymentSession!(context, args);

    expect(second.providerRef).toBe(first.providerRef);
    expect(first.status).toBe("processing");
    await expect(
      dummyPaymentGatewayPlugin.retrievePayment!(context, first.providerRef),
    ).resolves.toMatchObject({
      status: "processing",
      amountMinor: 1250,
      currency: "USD",
    });
  });

  it("supports controlled dummy success and failure outcomes", async () => {
    const make = (dummyOutcome: string) =>
      dummyPaymentGatewayPlugin.createPaymentSession!(context, {
        sessionId: `checkout-${dummyOutcome}`,
        amountMinor: 100,
        currency: "USD",
        saveMethod: false,
        paymentTypes: ["card"],
        description: "Test",
        metadata: { dummyOutcome },
      });

    await expect(make("succeeded")).resolves.toMatchObject({ status: "succeeded" });
    await expect(make("failed")).resolves.toMatchObject({ status: "failed" });
  });

  it("explicitly refuses dummy cancellation without changing durable state", async () => {
    const session = await dummyPaymentGatewayPlugin.createPaymentSession!(
      context,
      {
        sessionId: "checkout-cancel-refusal",
        amountMinor: 100,
        currency: "USD",
        saveMethod: false,
        paymentTypes: ["card"],
        description: "Test",
        metadata: { dummyOutcome: "processing" },
      },
    );

    await expect(
      dummyPaymentGatewayPlugin.cancelPayment!(context, session.providerRef),
    ).rejects.toMatchObject({
      name: "PaymentCancellationError",
      code: "cancellation_not_supported",
      retryable: false,
    });
    await expect(
      dummyPaymentGatewayPlugin.retrievePayment!(context, session.providerRef),
    ).resolves.toMatchObject({ status: "processing" });
  });

  it("enforces provider amount and configured payment-type gates", async () => {
    await expect(dummyPaymentGatewayPlugin.createPaymentSession!(context, {
      sessionId: "too-small",
      amountMinor: 99,
      currency: "USD",
      saveMethod: false,
      paymentTypes: ["card"],
      description: "Test",
      metadata: {},
    })).rejects.toThrow("at least 100 minor units");

    await expect(dummyPaymentGatewayPlugin.createPaymentSession!(context, {
      sessionId: "not-enabled",
      amountMinor: 100,
      currency: "USD",
      saveMethod: false,
      paymentTypes: ["us_bank_account"],
      description: "Test",
      metadata: {},
    })).rejects.toThrow("not enabled");
  });

  it("verifies dummy signatures and retains unsupported events", () => {
    const raw = Buffer.from(JSON.stringify({
      eventId: "evt-1",
      type: "payment.refunded",
    }));
    const signature = createHmac(
      "sha256",
      "sirius-dummy-gateway-testing-only",
    ).update(raw).digest("hex");

    expect(
      dummyPaymentGatewayPlugin.verifyWebhook!(context, raw, {
        "x-dummy-signature": signature,
      }),
    ).toMatchObject({
      eventId: "evt-1",
      type: "unsupported",
      providerEventType: "payment.refunded",
    });
    expect(() =>
      dummyPaymentGatewayPlugin.verifyWebhook!(context, raw, {
        "x-dummy-signature": "bad",
      }),
    ).toThrow("Invalid dummy webhook signature");
  });

  it("normalizes Stripe states without treating unknown states as success", () => {
    expect(normalizeStripePaymentStatus({
      status: "succeeded",
      last_payment_error: null,
    })).toBe("succeeded");
    expect(normalizeStripePaymentStatus({
      status: "requires_payment_method",
      last_payment_error: { message: "declined" },
    } as any)).toBe("failed");
    expect(normalizeStripePaymentStatus({
      status: "requires_payment_method",
      last_payment_error: null,
    })).toBe("created");
    expect(normalizeStripePaymentStatus({
      status: "future_provider_state",
      last_payment_error: null,
    } as any)).toBe("failed");
  });

  it("returns created for a new Stripe SDK intent awaiting a card or ACH method", async () => {
    const testContext = {
      apiKey: "sk_test_not_a_real_key",
      config: { id: "stripe-test", data: {
        publishableKey: "pk_test_not_a_real_key", paymentTypes: ["card", "us_bank_account"],
      } },
    } as PaymentGatewayContext;
    for (const paymentType of ["card", "us_bank_account"]) {
      stripeCreate.mockResolvedValueOnce({
        id: `pi_${paymentType}`, status: "requires_payment_method", amount: 1234,
        currency: "usd", client_secret: "cs_test", payment_method: null, last_payment_error: null,
      });
      const session = await stripePaymentGatewayPlugin.createPaymentSession!(testContext, {
        sessionId: `checkout-${paymentType}`, amountMinor: 1234, currency: "USD",
        saveMethod: false, paymentTypes: [paymentType], description: "Account payment", metadata: {},
      });
      expect(session).toMatchObject({
        providerRef: `pi_${paymentType}`, status: "created", clientSecret: "cs_test",
      });
      expect(stripeCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payment_method_types: [paymentType], confirm: undefined,
          customer: undefined, setup_future_usage: undefined,
        }),
        { idempotencyKey: `checkout-${paymentType}` },
      );
    }
  });

  it.each(["card", "us_bank_account"] as const)("requests Stripe future-use setup for an opted-in %s", async paymentType => {
    const testContext = {
      apiKey: "sk_test_not_a_real_key",
      config: { id: "stripe-test", data: {
        publishableKey: "pk_test_not_a_real_key", paymentTypes: ["card", "us_bank_account"],
      } },
    } as PaymentGatewayContext;
    stripeCreate.mockResolvedValueOnce({
      id: `pi_saved_${paymentType}`, status: "requires_payment_method", amount: 1234,
      currency: "usd", client_secret: "cs_test", payment_method: null, last_payment_error: null,
    });
    await stripePaymentGatewayPlugin.createPaymentSession!(testContext, {
      sessionId: `checkout-save-${paymentType}`, amountMinor: 1234, currency: "USD",
      customerRef: "cus_test", saveMethod: true, paymentTypes: [paymentType],
      description: "Account payment", metadata: {},
    });
    expect(stripeCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      customer: "cus_test", payment_method_types: [paymentType],
      setup_future_usage: "off_session",
    }), { idempotencyKey: `checkout-save-${paymentType}` });
  });

  it("refuses to create live Stripe charges", async () => {
    const liveContext = {
      apiKey: "sk_live_not_a_real_key",
      config: {
        id: "stripe-live",
        data: { publishableKey: "pk_live_not_a_real_key" },
      },
    } as PaymentGatewayContext;

    await expect(stripePaymentGatewayPlugin.createPaymentSession!(
      liveContext,
      {
        sessionId: "checkout-live",
        amountMinor: 100,
        currency: "USD",
        saveMethod: false,
        paymentTypes: ["card"],
        description: "Must not charge",
        metadata: {},
      },
    )).rejects.toThrow("test-mode");
  });

  it("rejects Stripe amounts and types before making a provider call", async () => {
    const testContext = {
      apiKey: "sk_test_not_a_real_key",
      config: {
        id: "stripe-test",
        data: {
          publishableKey: "pk_test_not_a_real_key",
          paymentTypes: ["card"],
        },
      },
    } as PaymentGatewayContext;
    const base = {
      sessionId: "checkout-gated",
      amountMinor: 100,
      currency: "USD",
      saveMethod: false,
      paymentTypes: ["card"],
      description: "Must be validated locally",
      metadata: {},
    };

    await expect(stripePaymentGatewayPlugin.createPaymentSession!(
      testContext,
      { ...base, amountMinor: 99 },
    )).rejects.toThrow("at least 100 minor units");
    await expect(stripePaymentGatewayPlugin.createPaymentSession!(
      testContext,
      { ...base, paymentTypes: ["us_bank_account"] },
    )).rejects.toThrow("not enabled");
  });

  it("normalizes Stripe payments and retains unsupported signed event payloads", () => {
    const paymentIntent = {
      id: "pi_123",
      object: "payment_intent",
      status: "processing",
      amount: 500,
      currency: "usd",
      client_secret: "secret",
      payment_method: "pm_123",
      last_payment_error: null,
    } as any;

    expect(normalizeStripePaymentIntent(paymentIntent)).toMatchObject({
      providerRef: "pi_123",
      status: "processing",
      amountMinor: 500,
      currency: "USD",
      methodRef: "pm_123",
    });
    expect(normalizeStripeWebhookEvent({
      id: "evt_123",
      type: "charge.refunded",
      created: 123,
      data: { object: { id: "ch_123", object: "charge" } },
    } as any)).toMatchObject({
      eventId: "evt_123",
      type: "unsupported",
      providerEventType: "charge.refunded",
      payload: { id: "ch_123", object: "charge" },
    });

    const event = normalizeStripeWebhookEvent({
      id: "evt_payment",
      type: "payment_intent.processing",
      created: 124,
      data: {
        object: {
          ...paymentIntent,
          client_secret: "must-not-be-retained",
          metadata: {
            attemptId: "attempt-123",
            privateNote: "must-not-be-retained",
          },
          payment_method: {
            id: "pm_123",
            type: "card",
            billing_details: { email: "private@example.com" },
            card: {
              brand: "visa",
              last4: "4242",
              exp_month: 12,
              exp_year: 2030,
            },
          },
        },
      },
    } as any);
    expect(event.payload).toEqual({
      object: "payment_intent",
      id: "pi_123",
      status: "processing",
      amount: 500,
      currency: "usd",
      paymentMethodRef: "pm_123",
      metadata: { attemptId: "attempt-123" },
    });
    expect(JSON.stringify(event.payload)).not.toContain("client_secret");
    expect(JSON.stringify(event.payload)).not.toContain("billing_details");
  });
});
