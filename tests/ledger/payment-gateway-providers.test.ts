import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PaymentGatewayContext } from "../../server/plugins/ledger/payment-gateway/types";
import { dummyPaymentGatewayPlugin } from "../../server/plugins/ledger/payment-gateway/plugins/dummy";
import {
  normalizeStripePaymentIntent,
  normalizeStripePaymentStatus,
  normalizeStripeWebhookEvent,
  stripePaymentGatewayPlugin,
} from "../../server/plugins/ledger/payment-gateway/plugins/stripe";

const context = {
  apiKey: "",
  config: { id: "dummy-config", data: {} },
} as PaymentGatewayContext;

describe("payment gateway provider contract", () => {
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