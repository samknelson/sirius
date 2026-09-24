import Stripe from "stripe";
import type {
  PaymentGatewayPlugin,
  PaymentGatewayContext,
  PaymentTypeOption,
  CreateCustomerInput,
  GatewayCustomerResult,
  GatewaySetupSession,
  GatewayMethodSummary,
  GatewayMethodDetails,
  GatewayConnectionTest,
  GatewayCustomerDetails,
  GatewayPaymentIntent,
  GatewayWebhookEvent,
  CreatePaymentSessionInput,
  GatewayPaymentSession,
  NormalizedGatewayEvent,
  NormalizedPayment,
  NormalizedPaymentStatus,
} from "../types";
import { registerPaymentGatewayPlugin } from "../registry";

/** Build a Stripe client from the per-config resolved secret. */
function client(ctx: PaymentGatewayContext): Stripe {
  return new Stripe(ctx.apiKey);
}

/** Provider config data may carry a publishable key + payment types. */
function configData(ctx: PaymentGatewayContext): Record<string, unknown> {
  const data = ctx.config.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function configuredPaymentTypes(ctx: PaymentGatewayContext): string[] {
  const configured = configData(ctx).paymentTypes;
  return Array.isArray(configured)
    ? configured.filter((type): type is string => typeof type === "string")
    : ["card", "us_bank_account"];
}

function assertAllowedPaymentTypes(
  ctx: PaymentGatewayContext,
  requested: string[],
): void {
  const allowed = new Set(configuredPaymentTypes(ctx));
  const supported = new Set(STRIPE_PAYMENT_TYPES.map((type) => type.id));
  if (
    requested.length === 0 ||
    requested.some((type) => !allowed.has(type) || !supported.has(type))
  ) {
    throw new GatewaySetupError(
      "The requested payment type is not enabled for this gateway.",
    );
  }
}

function assertPaymentAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100) {
    throw new GatewaySetupError(
      "Payment amount must be at least 100 minor units ($1.00 for USD).",
    );
  }
}

function assertOnlinePaymentTestCredentials(ctx: PaymentGatewayContext): void {
  const publishableKey =
    typeof configData(ctx).publishableKey === "string"
      ? String(configData(ctx).publishableKey)
      : "";
  if (!ctx.apiKey.startsWith("sk_test_") || !publishableKey.startsWith("pk_test_")) {
    const error = new Error(
      "Online Stripe payments require matching Stripe test-mode secret and publishable keys.",
    );
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }
}

function dashboardBaseUrl(ctx: PaymentGatewayContext): string {
  return ctx.apiKey.startsWith("sk_test_")
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com";
}

/**
 * Thrown when a gateway config has no payment type that can be saved as a
 * reusable method. Carries a 4xx `statusCode` so the route's error mapper can
 * surface it as an actionable client error instead of a generic 500.
 */
class GatewaySetupError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "GatewaySetupError";
  }
}

/**
 * Catalog of Stripe payment method types the editor offers. Stays here (not in
 * the UI) so the payment-types editor remains provider-agnostic. `setupEligible`
 * marks the types that can be SAVED as a reusable method via the SetupIntent
 * (add-a-payment-method) flow; charge-only types (PayPal, BNPL, single-use
 * redirects, vouchers) are excluded from that flow.
 */
const STRIPE_PAYMENT_TYPES: PaymentTypeOption[] = [
  { id: "card", name: "Credit/Debit Card", description: "Accept Visa, Mastercard, Amex, and other cards", setupEligible: true },
  { id: "us_bank_account", name: "US Bank Account (ACH)", description: "ACH direct debit payments", setupEligible: true },
  { id: "cashapp", name: "Cash App Pay", description: "Accept payments via Cash App", setupEligible: true },
  { id: "paypal", name: "PayPal", description: "Accept payments via PayPal", setupEligible: false },
  { id: "link", name: "Link", description: "Stripe's one-click payment method", setupEligible: true },
  { id: "affirm", name: "Affirm", description: "Buy now, pay later with Affirm", setupEligible: false },
  { id: "afterpay_clearpay", name: "Afterpay / Clearpay", description: "Buy now, pay later", setupEligible: false },
  { id: "klarna", name: "Klarna", description: "Buy now, pay later with Klarna", setupEligible: false },
  { id: "alipay", name: "Alipay", description: "Popular payment method in China", setupEligible: false },
  { id: "wechat_pay", name: "WeChat Pay", description: "Popular payment method in China", setupEligible: false },
  { id: "ideal", name: "iDEAL", description: "Popular payment method in Netherlands", setupEligible: false },
  { id: "sepa_debit", name: "SEPA Direct Debit", description: "European bank debits", setupEligible: true },
  { id: "bancontact", name: "Bancontact", description: "Popular payment method in Belgium", setupEligible: false },
  { id: "giropay", name: "Giropay", description: "Popular payment method in Germany", setupEligible: false },
  { id: "eps", name: "EPS", description: "Popular payment method in Austria", setupEligible: false },
  { id: "p24", name: "Przelewy24", description: "Popular payment method in Poland", setupEligible: false },
  { id: "blik", name: "BLIK", description: "Mobile payment method in Poland", setupEligible: false },
  { id: "acss_debit", name: "ACSS Debit", description: "Pre-authorized debit in Canada", setupEligible: true },
  { id: "au_becs_debit", name: "BECS Direct Debit", description: "Direct debit in Australia", setupEligible: true },
  { id: "bacs_debit", name: "Bacs Direct Debit", description: "Direct debit in UK", setupEligible: true },
  { id: "fpx", name: "FPX", description: "Online banking in Malaysia", setupEligible: false },
  { id: "grabpay", name: "GrabPay", description: "Popular digital wallet in Southeast Asia", setupEligible: false },
  { id: "paynow", name: "PayNow", description: "Real-time payment in Singapore", setupEligible: false },
  { id: "promptpay", name: "PromptPay", description: "Real-time payment in Thailand", setupEligible: false },
  { id: "pix", name: "Pix", description: "Instant payment method in Brazil", setupEligible: false },
  { id: "boleto", name: "Boleto", description: "Cash-based voucher payment in Brazil", setupEligible: false },
  { id: "oxxo", name: "OXXO", description: "Cash-based voucher payment in Mexico", setupEligible: false },
  { id: "konbini", name: "Konbini", description: "Cash payment at convenience stores in Japan", setupEligible: false },
  { id: "customer_balance", name: "Customer Balance", description: "Use customer account balance", setupEligible: false },
  { id: "sofort", name: "Sofort", description: "Bank redirect in Europe (deprecated, use Klarna)", setupEligible: false },
];

/** Ids from the catalog that are valid for the save-a-method (SetupIntent) flow. */
const SETUP_ELIGIBLE_TYPE_IDS = new Set(
  STRIPE_PAYMENT_TYPES.filter((t) => t.setupEligible).map((t) => t.id),
);

/**
 * Stripe payment gateway. Each `payment-gateway` config row of this plugin
 * names the secret holding the Stripe API credentials (stored as
 * `data.secretName`; resolved from the environment at use-time). Gated on the
 * existing `ledger.stripe` component. Provider-only — no storage/DB access.
 */
export const stripePaymentGatewayPlugin: PaymentGatewayPlugin = {
  id: "stripe",
  name: "Stripe",
  description:
    "Stripe payment gateway. Each configuration names the secret that holds the Stripe API credentials.",
  requiredComponent: "ledger.stripe",
  addComponentId: "stripe:StripeAddPaymentMethod",
  payComponentId: "stripe:StripePayComponent",

  // The publishable key the browser needs to load Stripe Elements. Stored in
  // the config's `data` json (no schema change). Required: there is no env
  // fallback anymore, so a Stripe config without it cannot collect a card.
  configFields: [
    {
      name: "publishableKey",
      label: "Publishable Key",
      type: "string",
      required: true,
    },
    {
      name: "webhookSecretName",
      label: "Webhook Signing Secret Name",
      type: "string",
      required: true,
    },
  ],

  // Presence of the publishable key is enforced generically (configFields
  // `required`); here we add the Stripe-specific format check. A test/live key
  // always starts with `pk_`, never the secret `sk_`/`rk_` prefixes.
  validateConfig(data: Record<string, unknown>) {
    const key =
      typeof data.publishableKey === "string" ? data.publishableKey.trim() : "";
    if (key && !key.startsWith("pk_")) {
      return {
        valid: false,
        errors: ['Publishable Key must start with "pk_".'],
      };
    }
    return { valid: true };
  },

  // Catalog of Stripe payment method types the editor offers (defined at module
  // scope so the setup flow can share the `setupEligible` markers).
  supportedPaymentTypes: STRIPE_PAYMENT_TYPES,

  async createPaymentIntent(ctx, args): Promise<GatewayPaymentIntent> {
    assertOnlinePaymentTestCredentials(ctx);
    assertPaymentAmount(args.amount);
    const configured = configuredPaymentTypes(ctx);
    const type = args.paymentMethodType ??
      configured.find((t) => t === "card" || t === "us_bank_account") ??
      configured[0];
    if (!type) {
      throw new GatewaySetupError("This gateway has no enabled payment types.");
    }
    assertAllowedPaymentTypes(ctx, [type]);
    const intent = await client(ctx).paymentIntents.create({
      amount: args.amount,
      currency: args.currency.toLowerCase(),
      customer: args.customerRef,
      payment_method: args.paymentMethodRef,
      payment_method_types: [type],
      confirm: true,
      metadata: args.metadata ?? {},
    }, { idempotencyKey: args.idempotencyKey });
    return normalizeIntent(intent);
  },

  async retrievePaymentIntent(ctx, providerIntentRef) {
    return normalizeIntent(await client(ctx).paymentIntents.retrieve(providerIntentRef));
  },

  constructWebhookEvent(ctx, rawBody, signature): GatewayWebhookEvent {
    const webhookSecret = ctx.webhookSecret;
    if (!webhookSecret) {
      const error = new Error("Stripe webhook signing secret is not configured");
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }
    const event = client(ctx).webhooks.constructEvent(rawBody, signature, webhookSecret);
    return { id: event.id, type: event.type, data: event.data.object, created: event.created };
  },

  async createPaymentSession(
    ctx,
    args: CreatePaymentSessionInput,
  ): Promise<GatewayPaymentSession> {
    assertOnlinePaymentTestCredentials(ctx);
    assertPaymentAmount(args.amountMinor);
    assertAllowedPaymentTypes(ctx, args.paymentTypes);
    if ((args.saveMethod || args.savedMethodRef) && !args.customerRef) {
      throw new GatewaySetupError(
        "A provider customer is required to save or use a saved payment method.",
      );
    }

    const data = configData(ctx);
    const publishableKey =
      typeof data.publishableKey === "string" ? data.publishableKey : "";
    const intent = await client(ctx).paymentIntents.create(
      {
        amount: args.amountMinor,
        currency: args.currency.toLowerCase(),
        customer: args.customerRef,
        payment_method: args.savedMethodRef,
        payment_method_types:
          args.paymentTypes as Stripe.PaymentIntentCreateParams["payment_method_types"],
        confirm: args.savedMethodRef ? true : undefined,
        setup_future_usage: args.saveMethod ? "off_session" : undefined,
        description: args.description,
        metadata: {
          ...args.metadata,
          attemptId: args.sessionId,
        },
      },
      { idempotencyKey: args.sessionId },
    );
    const normalized = normalizeStripePaymentIntent(intent);
    return {
      providerRef: normalized.providerRef,
      clientSecret: normalized.clientSecret ?? "",
      publicConfig: {
        publishableKey,
        paymentTypes: args.paymentTypes,
      },
      status: normalized.status,
    };
  },

  async retrievePayment(ctx, providerRef): Promise<NormalizedPayment> {
    const intent = await client(ctx).paymentIntents.retrieve(providerRef, {
      expand: ["payment_method"],
    });
    return normalizeStripePaymentIntent(intent);
  },

  verifyWebhook(ctx, rawBody, headers): NormalizedGatewayEvent {
    const webhookSecret = ctx.webhookSecret;
    if (!webhookSecret) {
      const error = new Error("Stripe webhook signing secret is not configured");
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }
    const signature = headers["stripe-signature"];
    if (!signature) {
      const error = new Error("Stripe webhook signature is required");
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    const event = client(ctx).webhooks.constructEvent(rawBody, signature, webhookSecret);
    return normalizeStripeWebhookEvent(event);
  },

  async cancelPayment(ctx, providerRef): Promise<NormalizedPayment> {
    assertOnlinePaymentTestCredentials(ctx);
    return normalizeStripePaymentIntent(
      await client(ctx).paymentIntents.cancel(providerRef),
    );
  },

  async testConnection(ctx: PaymentGatewayContext): Promise<GatewayConnectionTest> {
    try {
      const c = client(ctx);
      const account = await c.accounts.retrieve();
      const balance = await c.balance.retrieve();
      return {
        connected: true,
        account: {
          id: account.id,
          email: account.email,
          country: account.country,
          defaultCurrency: account.default_currency,
          type: account.type,
          capabilities: [
            { label: "Charges Enabled", enabled: !!account.charges_enabled },
            { label: "Payouts Enabled", enabled: !!account.payouts_enabled },
            { label: "Details Submitted", enabled: !!account.details_submitted },
          ],
        },
        balances: [
          ...balance.available.map((b) => ({
            label: "Available",
            amount: b.amount,
            currency: b.currency,
          })),
          ...balance.pending.map((b) => ({
            label: "Pending",
            amount: b.amount,
            currency: b.currency,
          })),
        ],
        testMode: ctx.apiKey.startsWith("sk_test_"),
      };
    } catch (error: any) {
      return {
        connected: false,
        error: {
          message: error.message || "Failed to connect to Stripe",
          type: error.type,
          code: error.code,
        },
      };
    }
  },

  async createCustomer(
    ctx: PaymentGatewayContext,
    input: CreateCustomerInput,
  ): Promise<GatewayCustomerResult> {
    const customer = await client(ctx).customers.create({
      name: input.name,
      metadata: input.metadata ?? {},
    });
    return { customerRef: customer.id };
  },

  async retrieveCustomer(
    ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<{ exists: boolean }> {
    try {
      const customer = await client(ctx).customers.retrieve(customerRef);
      return { exists: !(customer as Stripe.DeletedCustomer).deleted };
    } catch (error: any) {
      if (error.code === "resource_missing") {
        return { exists: false };
      }
      throw error;
    }
  },

  async getCustomerDetails(
    ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<GatewayCustomerDetails> {
    const customer = (await client(ctx).customers.retrieve(
      customerRef,
    )) as Stripe.Customer | Stripe.DeletedCustomer;
    if ((customer as Stripe.DeletedCustomer).deleted) {
      const err: any = new Error("Customer has been deleted at Stripe");
      err.code = "resource_missing";
      throw err;
    }
    const c = customer as Stripe.Customer;
    return {
      id: c.id,
      name: c.name ?? null,
      email: c.email ?? null,
      created: c.created ?? null,
      currency: c.currency ?? null,
      balance: c.balance ?? null,
      delinquent: c.delinquent ?? null,
      providerUrl: `${dashboardBaseUrl(ctx)}/customers/${c.id}`,
    };
  },

  async createSetupSession(
    ctx: PaymentGatewayContext,
    args: { customerRef: string },
  ): Promise<GatewaySetupSession> {
    // SetupIntent is provider entry too: never let a test-only worker fixture
    // (or any other caller) create a live-mode payment method session.
    assertOnlinePaymentTestCredentials(ctx);
    const data = configData(ctx);
    const configured = Array.isArray(data.paymentTypes)
      ? (data.paymentTypes as string[])
      : ["card", "us_bank_account"];
    // Only types that can be SAVED as a reusable method work on a SetupIntent.
    // If the config carries any charge-only type (PayPal, BNPL, vouchers,
    // single-use redirects), fail with a clear, actionable error that NAMES the
    // offending type(s) instead of letting Stripe reject the call with an opaque
    // 500. The Gateway Payment Types editor prevents creating this state going
    // forward; this guard covers configs saved before that.
    const ineligible = configured.filter((t) => !SETUP_ELIGIBLE_TYPE_IDS.has(t));
    if (ineligible.length > 0) {
      throw new GatewaySetupError(
        `These payment types can't be saved as a reusable payment method: ${ineligible.join(", ")}. Remove them under Gateway Payment Types and keep a card or bank account type.`,
      );
    }
    if (configured.length === 0) {
      throw new GatewaySetupError(
        "This gateway has no payment types that can be saved as a reusable payment method. Enable a card or bank account type under Gateway Payment Types.",
      );
    }
    const paymentTypes = configured;

    const setupIntent = await client(ctx).setupIntents.create({
      customer: args.customerRef,
      payment_method_types: paymentTypes,
    });

    // Single source of truth: the publishable key lives only in the config
    // `data` (entered via the admin form). No environment-variable fallback.
    const publishableKey =
      typeof data.publishableKey === "string" ? data.publishableKey : "";

    return {
      clientSecret: setupIntent.client_secret ?? "",
      publicConfig: {
        publishableKey,
        paymentTypes,
      },
    };
  },

  async attachMethod(
    ctx: PaymentGatewayContext,
    args: { customerRef: string; methodToken: string },
  ): Promise<void> {
    await client(ctx).paymentMethods.attach(args.methodToken, {
      customer: args.customerRef,
    });
  },

  async getMethodSummary(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodSummary> {
    const pm = await client(ctx).paymentMethods.retrieve(methodRef);
    return {
      type: pm.type,
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : null,
      us_bank_account: pm.us_bank_account
        ? {
            bank_name: pm.us_bank_account.bank_name,
            last4: pm.us_bank_account.last4,
            account_holder_type: pm.us_bank_account.account_holder_type,
            account_type: pm.us_bank_account.account_type,
          }
        : null,
      billing_details: pm.billing_details,
    };
  },

  async getMethodDetails(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodDetails> {
    const pm = await client(ctx).paymentMethods.retrieve(methodRef);
    return {
      paymentMethod: pm,
      providerUrl: `${dashboardBaseUrl(ctx)}/payment_methods/${pm.id}`,
    };
  },

  async detachMethod(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<void> {
    await client(ctx).paymentMethods.detach(methodRef);
  },
};

function normalizeIntent(intent: Stripe.PaymentIntent): GatewayPaymentIntent {
  const status: GatewayPaymentIntent["status"] =
    intent.status === "succeeded" ? "succeeded" :
      intent.status === "processing" ? "processing" :
        intent.status === "requires_action" || intent.status === "requires_confirmation"
          ? "requires_action" : "failed";
  return {
    providerIntentRef: intent.id,
    status,
    clientSecret: intent.client_secret,
    amount: intent.amount,
    currency: intent.currency,
    paymentMethodType: typeof intent.payment_method === "object" && intent.payment_method
      ? intent.payment_method.type : null,
    failureMessage: intent.last_payment_error?.message ?? null,
  };
}

export function normalizeStripePaymentStatus(
  intent: Pick<Stripe.PaymentIntent, "status" | "last_payment_error">,
): NormalizedPaymentStatus {
  switch (intent.status) {
    case "succeeded":
      return "succeeded";
    case "processing":
    case "requires_capture":
      return "processing";
    case "canceled":
      return "canceled";
    case "requires_action":
    case "requires_confirmation":
      return "requires_action";
    case "requires_payment_method":
      return intent.last_payment_error ? "failed" : "created";
    default:
      // Fail closed if Stripe adds a status: never mistake an unknown state
      // for settled money.
      return "failed";
  }
}

function stripeMethodSummary(
  method: Stripe.PaymentMethod,
): GatewayMethodSummary {
  return {
    type: method.type,
    card: method.card
      ? {
          brand: method.card.brand,
          last4: method.card.last4,
          expMonth: method.card.exp_month,
          expYear: method.card.exp_year,
        }
      : null,
    us_bank_account: method.us_bank_account
      ? {
          bank_name: method.us_bank_account.bank_name,
          last4: method.us_bank_account.last4,
          account_holder_type: method.us_bank_account.account_holder_type,
          account_type: method.us_bank_account.account_type,
        }
      : null,
  };
}

function boundedString(value: unknown, max = 255): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

/**
 * Webhook inbox payloads intentionally carry only a bounded routing/audit
 * descriptor. Stripe's raw object can contain client secrets, billing details,
 * and other payer data that this application must not persist.
 */
function safeStripeEventPayload(
  object: Stripe.Event.Data.Object,
): Record<string, unknown> {
  const record = object as unknown as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  const objectType = boundedString(record.object, 80);
  const id = boundedString(record.id);
  if (objectType) safe.object = objectType;
  if (id) safe.id = id;
  if (objectType === "payment_intent") {
    const status = boundedString(record.status, 80);
    const currency = boundedString(record.currency, 10);
    const method =
      typeof record.payment_method === "string"
        ? boundedString(record.payment_method)
        : boundedString(
            (record.payment_method as Record<string, unknown> | null)?.id,
          );
    if (status) safe.status = status;
    if (typeof record.amount === "number" && Number.isSafeInteger(record.amount)) {
      safe.amount = record.amount;
    }
    if (currency) safe.currency = currency;
    if (method) safe.paymentMethodRef = method;
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? record.metadata as Record<string, unknown>
        : undefined;
    const attemptId = boundedString(metadata?.attemptId);
    if (attemptId) safe.metadata = { attemptId };
  }
  return safe;
}

export function normalizeStripePaymentIntent(
  intent: Stripe.PaymentIntent,
): NormalizedPayment {
  const method =
    intent.payment_method && typeof intent.payment_method === "object"
      ? intent.payment_method
      : undefined;
  return {
    providerRef: intent.id,
    status: normalizeStripePaymentStatus(intent),
    amountMinor: intent.amount,
    currency: intent.currency.toUpperCase(),
    clientSecret: intent.client_secret,
    methodRef:
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id,
    methodType: method?.type,
    failureCode: intent.last_payment_error?.code,
    failureMessage: intent.last_payment_error?.message,
    methodSummary: method ? stripeMethodSummary(method) : undefined,
  };
}

export function normalizeStripeWebhookEvent(
  event: Stripe.Event,
): NormalizedGatewayEvent {
  const normalizedType: NormalizedGatewayEvent["type"] =
    event.type === "payment_intent.processing"
      ? "payment.processing"
      : event.type === "payment_intent.succeeded"
        ? "payment.succeeded"
        : event.type === "payment_intent.payment_failed"
          ? "payment.failed"
          : event.type === "payment_intent.canceled"
            ? "payment.canceled"
            : "unsupported";
  const object = event.data.object;
  const isPaymentIntent =
    object &&
    typeof object === "object" &&
    (object as { object?: string }).object === "payment_intent";
  const payment = isPaymentIntent
    ? normalizeStripePaymentIntent(object as Stripe.PaymentIntent)
    : undefined;
  return {
    eventId: event.id,
    type: normalizedType,
    providerEventType: event.type,
    providerRef: payment?.providerRef,
    methodRef: payment?.methodRef,
    amountMinor: payment?.amountMinor,
    currency: payment?.currency,
    failureCode: payment?.failureCode,
    failureMessage: payment?.failureMessage,
    methodSummary: payment?.methodSummary,
    providerCreated: event.created,
    payload: safeStripeEventPayload(object),
  };
}

registerPaymentGatewayPlugin(stripePaymentGatewayPlugin);
