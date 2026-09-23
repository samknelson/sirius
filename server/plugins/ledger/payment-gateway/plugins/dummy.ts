import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import type {
  PaymentGatewayPlugin,
  PaymentGatewayContext,
  CreateCustomerInput,
  GatewayCustomerResult,
  GatewaySetupSession,
  GatewayMethodSummary,
  GatewayMethodDetails,
  GatewayConnectionTest,
  GatewayCustomerDetails,
  CreatePaymentSessionInput,
  GatewayPaymentIntent,
  GatewayPaymentSession,
  NormalizedGatewayEvent,
  NormalizedPayment,
  NormalizedPaymentStatus,
} from "../types";
import { PaymentCancellationError } from "../types";
import { registerPaymentGatewayPlugin } from "../registry";

/**
 * Opaque method-reference format shared with the client add-form. The token
 * carries ONLY the non-sensitive card descriptor (brand, last 4, expiry) —
 * never the full PAN or the CVC, and no free-form field that could smuggle
 * one. The client encodes it and the server decodes it here to enrich the
 * list/detail views.
 */
const DUMMY_METHOD_PREFIX = "dummy_pm_";
const DUMMY_PAYMENT_PREFIX = "dummy_pi_";
const DUMMY_WEBHOOK_TEST_KEY = "sirius-dummy-gateway-testing-only";

interface DummyPaymentPayload {
  v: 1;
  key: string;
  amountMinor: number;
  currency: string;
  status: NormalizedPaymentStatus;
  methodRef?: string;
  methodType?: string;
}

function encodePayment(payload: DummyPaymentPayload): string {
  return `${DUMMY_PAYMENT_PREFIX}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function decodePayment(providerRef: string): DummyPaymentPayload {
  if (
    providerRef.length > 4096 ||
    !providerRef.startsWith(DUMMY_PAYMENT_PREFIX)
  ) {
    throw new Error("Malformed dummy payment reference");
  }
  let value: unknown;
  try {
    value = JSON.parse(
      Buffer.from(providerRef.slice(DUMMY_PAYMENT_PREFIX.length), "base64url").toString("utf8"),
    );
  } catch {
    throw new Error("Malformed dummy payment reference");
  }
  const payment = value as Partial<DummyPaymentPayload>;
  const statuses: NormalizedPaymentStatus[] = [
    "created",
    "requires_action",
    "processing",
    "succeeded",
    "failed",
    "canceled",
  ];
  if (
    !payment ||
    payment.v !== 1 ||
    typeof payment.key !== "string" ||
    !/^[a-f0-9]{24}$/.test(payment.key) ||
    typeof payment.amountMinor !== "number" ||
    !Number.isSafeInteger(payment.amountMinor) ||
    payment.amountMinor <= 0 ||
    typeof payment.currency !== "string" ||
    !/^[A-Z]{3}$/.test(payment.currency) ||
    (payment.methodRef !== undefined &&
      (typeof payment.methodRef !== "string" || payment.methodRef.length > 1024)) ||
    (payment.methodType !== undefined &&
      payment.methodType !== "card") ||
    !payment.status ||
    !statuses.includes(payment.status)
  ) {
    throw new Error("Malformed dummy payment reference");
  }
  if (payment.methodRef) decodeMethodRef(payment.methodRef);
  return payment as DummyPaymentPayload;
}

function configuredPaymentTypes(ctx: PaymentGatewayContext): string[] {
  const data =
    ctx.config.data && typeof ctx.config.data === "object"
      ? ctx.config.data as Record<string, unknown>
      : {};
  return Array.isArray(data.paymentTypes)
    ? data.paymentTypes.filter((type): type is string => typeof type === "string")
    : ["card"];
}

function assertPaymentInput(
  ctx: PaymentGatewayContext,
  amountMinor: number,
  paymentTypes: string[],
): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100) {
    throw new Error(
      "Payment amount must be at least 100 minor units ($1.00 for USD)",
    );
  }
  const allowed = new Set(configuredPaymentTypes(ctx));
  if (
    paymentTypes.length === 0 ||
    paymentTypes.some((type) => type !== "card" || !allowed.has(type))
  ) {
    throw new Error("The requested payment type is not enabled for this gateway");
  }
}

function normalizedDummyPayment(
  providerRef: string,
): NormalizedPayment {
  const payment = decodePayment(providerRef);
  return {
    providerRef,
    status: payment.status,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    methodRef: payment.methodRef,
    methodType: payment.methodType,
    failureCode: payment.status === "failed" ? "dummy_declined" : undefined,
    failureMessage: payment.status === "failed" ? "Dummy payment was declined" : undefined,
  };
}

function dummyOutcome(
  metadata: Record<string, string>,
): "succeeded" | "failed" | "processing" {
  const outcome = metadata.dummyOutcome;
  return outcome === "failed" || outcome === "processing" || outcome === "succeeded"
    ? outcome
    : "succeeded";
}

/**
 * The exact, allowed key set for a decoded dummy token. Anything else (e.g. a
 * `pan`, `number`, `cvc`, or a free-form `nonce` field) is rejected so sensitive
 * card data can never be persisted, even if a crafted client bypasses the UI.
 * Every allowed field below is strictly bounded (brand allowlist, 4-digit
 * last4, calendar-range expiry), so none can carry a full card number.
 */
const ALLOWED_TOKEN_KEYS = ["brand", "last4", "expMonth", "expYear"];

/** Brands the client's detector can emit; anything else is rejected. */
const ALLOWED_BRANDS = [
  "visa",
  "mastercard",
  "amex",
  "discover",
  "diners",
  "jcb",
  "card",
];

interface DummyCardMeta {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/**
 * Strictly decode and validate an opaque dummy method reference. Throws on any
 * deviation from the expected `{brand,last4,expMonth,expYear,nonce}` shape —
 * including unexpected keys — so a payload carrying a full PAN or CVC is
 * refused before it can ever be stored. This is the server-side guarantee
 * behind "store only brand/expiry/last 4, never the PAN or CVC".
 */
function decodeMethodRef(methodRef: string): DummyCardMeta {
  if (typeof methodRef !== "string" || !methodRef.startsWith(DUMMY_METHOD_PREFIX)) {
    throw new Error("Malformed dummy payment-method reference");
  }
  const encoded = methodRef.slice(DUMMY_METHOD_PREFIX.length);
  // Cap the payload size: a legitimate token is tiny; an oversized one is a
  // red flag (e.g. an attempt to smuggle extra data).
  if (encoded.length === 0 || encoded.length > 512) {
    throw new Error("Malformed dummy payment-method reference");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Malformed dummy payment-method reference");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed dummy payment-method reference");
  }

  const obj = parsed as Record<string, unknown>;
  // Reject any unexpected field (a PAN/CVC could only ride in as an extra key
  // or by abusing an allowed one — both are blocked here).
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOKEN_KEYS.includes(key)) {
      throw new Error("Dummy payment-method reference has unexpected fields");
    }
  }

  const { brand, last4, expMonth, expYear } = obj;
  if (typeof brand !== "string" || !ALLOWED_BRANDS.includes(brand)) {
    throw new Error("Dummy payment-method reference has an invalid brand");
  }
  if (typeof last4 !== "string" || !/^\d{4}$/.test(last4)) {
    throw new Error("Dummy payment-method reference has an invalid last4");
  }
  if (
    typeof expMonth !== "number" ||
    !Number.isInteger(expMonth) ||
    expMonth < 1 ||
    expMonth > 12
  ) {
    throw new Error("Dummy payment-method reference has an invalid expiry month");
  }
  if (
    typeof expYear !== "number" ||
    !Number.isInteger(expYear) ||
    expYear < 2000 ||
    expYear > 2100
  ) {
    throw new Error("Dummy payment-method reference has an invalid expiry year");
  }

  return { brand, last4, expMonth, expYear };
}

/**
 * Dummy payment gateway for testing the full payment-method lifecycle without
 * real provider credentials. It is stateless: there is no remote provider, so
 * every "provider" call is synthesized in-process. Customers get a stable
 * synthetic reference (the generic module persists the mapping), and method
 * details are decoded straight out of the opaque token the client produced.
 *
 * Gated on the `ledger.dummy_gateway` component. The matching config names a
 * `DUMMY_GATEWAY` secret to exercise the secret-naming path, but the plugin
 * opts out of requiring it (`requiresSecret: false`), so the gateway resolves
 * whether or not the env var is set. Provider-only — no storage/DB access.
 */
export const dummyPaymentGatewayPlugin: PaymentGatewayPlugin = {
  id: "dummy",
  name: "Dummy (Testing)",
  description:
    "A fake payment gateway for testing the full payment lifecycle without a real provider. Stores only the card brand, expiry, and last 4 digits.",
  requiredComponent: "ledger.dummy_gateway",
  addComponentId: "dummy:DummyAddPaymentMethod",
  payComponentId: "dummy:DummyPayComponent",
  // No real credentials needed — works even when DUMMY_GATEWAY is unset.
  requiresSecret: false,

  supportedPaymentTypes: [
    {
      id: "card",
      name: "Credit/Debit Card",
      description: "Hand-typed test card (no real charges are made)",
    },
  ],

  async createPaymentIntent(ctx, args): Promise<GatewayPaymentIntent> {
    const methodType = args.paymentMethodType ?? "card";
    assertPaymentInput(ctx, args.amount, [methodType]);
    decodeMethodRef(args.paymentMethodRef);
    const status = dummyOutcome(args.metadata ?? {});
    const providerRef = encodePayment({
      v: 1,
      key: createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 24),
      amountMinor: args.amount,
      currency: args.currency.toUpperCase(),
      status,
      methodRef: args.paymentMethodRef,
      methodType,
    });
    return {
      providerIntentRef: providerRef,
      status,
      clientSecret: `dummy_secret_${createHash("sha256").update(providerRef).digest("hex")}`,
      amount: args.amount,
      currency: args.currency.toUpperCase(),
      paymentMethodType: methodType,
      failureMessage: status === "failed" ? "Dummy payment was declined" : null,
    };
  },

  async retrievePaymentIntent(_ctx, providerRef): Promise<GatewayPaymentIntent> {
    const payment = normalizedDummyPayment(providerRef);
    return {
      providerIntentRef: providerRef,
      status: payment.status === "canceled" ? "failed" : payment.status === "created"
        ? "requires_action" : payment.status,
      clientSecret: `dummy_secret_${createHash("sha256").update(providerRef).digest("hex")}`,
      amount: payment.amountMinor,
      currency: payment.currency,
      paymentMethodType: payment.methodType,
      failureMessage: payment.failureMessage ?? null,
    };
  },

  async createPaymentSession(
    ctx,
    args: CreatePaymentSessionInput,
  ): Promise<GatewayPaymentSession> {
    assertPaymentInput(ctx, args.amountMinor, args.paymentTypes);
    if ((args.saveMethod || args.savedMethodRef) && !args.customerRef) {
      throw new Error("A customer is required to save or use a saved payment method");
    }
    if (args.savedMethodRef) decodeMethodRef(args.savedMethodRef);
    const status = dummyOutcome(args.metadata);
    const methodType = args.paymentTypes[0];
    const providerRef = encodePayment({
      v: 1,
      key: createHash("sha256").update(args.sessionId).digest("hex").slice(0, 24),
      amountMinor: args.amountMinor,
      currency: args.currency.toUpperCase(),
      status,
      methodRef: args.savedMethodRef,
      methodType,
    });
    return {
      providerRef,
      clientSecret: `dummy_secret_${createHash("sha256").update(providerRef).digest("hex")}`,
      publicConfig: { gateway: "dummy", paymentTypes: args.paymentTypes },
      status,
    };
  },

  async retrievePayment(_ctx, providerRef): Promise<NormalizedPayment> {
    return normalizedDummyPayment(providerRef);
  },

  async cancelPayment(_ctx, providerRef): Promise<NormalizedPayment> {
    const payment = normalizedDummyPayment(providerRef);
    if (
      payment.status === "succeeded" ||
      payment.status === "failed" ||
      payment.status === "canceled"
    ) {
      throw new PaymentCancellationError(
        "payment_not_cancelable",
        `Dummy payment is already ${payment.status} and cannot be canceled`,
      );
    }
    throw new PaymentCancellationError(
      "cancellation_not_supported",
      "The stateless dummy provider does not support payment cancellation",
    );
  },

  verifyWebhook(ctx, rawBody, headers): NormalizedGatewayEvent {
    const supplied = headers["x-dummy-signature"];
    const key = ctx.webhookSecret || ctx.apiKey || DUMMY_WEBHOOK_TEST_KEY;
    const expected = createHmac("sha256", key).update(rawBody).digest("hex");
    if (
      !supplied ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      throw new Error("Invalid dummy webhook signature");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new Error("Invalid dummy webhook payload");
    }
    const body = payload as Record<string, unknown>;
    if (
      typeof body.eventId !== "string" ||
      body.eventId.length === 0 ||
      body.eventId.length > 255 ||
      typeof body.type !== "string" ||
      body.type.length === 0 ||
      body.type.length > 100
    ) {
      throw new Error("Invalid dummy webhook payload");
    }
    const knownTypes = new Set([
      "payment.processing",
      "payment.succeeded",
      "payment.failed",
      "payment.canceled",
    ]);
    const providerRef =
      typeof body.providerRef === "string" && body.providerRef.length <= 4096
        ? body.providerRef
        : undefined;
    const payment = providerRef ? normalizedDummyPayment(providerRef) : undefined;
    return {
      eventId: body.eventId,
      type: knownTypes.has(body.type)
        ? body.type as NormalizedGatewayEvent["type"]
        : "unsupported",
      providerEventType: body.type,
      providerRef,
      methodRef: payment?.methodRef,
      amountMinor: payment?.amountMinor,
      currency: payment?.currency,
      failureCode: body.type === "payment.failed" ? "dummy_declined" : undefined,
      failureMessage:
        body.type === "payment.failed" ? "Dummy payment was declined" : undefined,
      payload: {
        eventId: body.eventId,
        type: body.type,
        ...(providerRef ? { providerRef } : {}),
      },
    };
  },

  async testConnection(_ctx: PaymentGatewayContext): Promise<GatewayConnectionTest> {
    return {
      connected: true,
      account: {
        id: "dummy_account",
        type: "test",
        defaultCurrency: "usd",
        capabilities: [{ label: "Test Mode", enabled: true }],
      },
      testMode: true,
    };
  },

  async createCustomer(
    _ctx: PaymentGatewayContext,
    _input: CreateCustomerInput,
  ): Promise<GatewayCustomerResult> {
    return { customerRef: `dummy_cus_${randomBytes(8).toString("hex")}` };
  },

  async retrieveCustomer(
    _ctx: PaymentGatewayContext,
    _customerRef: string,
  ): Promise<{ exists: boolean }> {
    // The dummy gateway never loses customers.
    return { exists: true };
  },

  async getCustomerDetails(
    _ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<GatewayCustomerDetails> {
    return {
      id: customerRef,
      name: null,
      email: null,
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      balance: 0,
      delinquent: false,
    };
  },

  async createSetupSession(
    _ctx: PaymentGatewayContext,
    _args: { customerRef: string },
  ): Promise<GatewaySetupSession> {
    // The client add-form collects the card itself and ignores the secret, so
    // the session payload is purely a placeholder.
    return {
      clientSecret: `dummy_setup_${randomBytes(8).toString("hex")}`,
      publicConfig: { gateway: "dummy" },
    };
  },

  async attachMethod(
    _ctx: PaymentGatewayContext,
    args: { customerRef: string; methodToken: string },
  ): Promise<void> {
    // There is no remote provider to attach to, but this hook runs BEFORE the
    // generic module persists the token, so it is the enforcement point: reject
    // anything that isn't a clean brand/expiry/last4 token. This guarantees a
    // full PAN or CVC can never be stored, even from a crafted client.
    decodeMethodRef(args.methodToken);
  },

  async getMethodSummary(
    _ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodSummary> {
    const card = decodeMethodRef(methodRef);
    return {
      type: "card",
      card: {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
      },
      billing_details: { name: null, email: null },
    };
  },

  async getMethodDetails(
    _ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodDetails> {
    const card = decodeMethodRef(methodRef);
    return {
      paymentMethod: {
        id: methodRef,
        type: "card",
        card: {
          brand: card.brand,
          last4: card.last4,
          exp_month: card.expMonth,
          exp_year: card.expYear,
        },
      },
    };
  },

  async detachMethod(
    _ctx: PaymentGatewayContext,
    _methodRef: string,
  ): Promise<void> {
    // Nothing to detach on a stateless dummy provider.
  },
};

registerPaymentGatewayPlugin(dummyPaymentGatewayPlugin);
